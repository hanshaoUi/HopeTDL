use crate::{engine::Engine, jobs, millis, now, text, Result};
use serde_json::{json, Value};
use std::{path::Path, sync::Arc, time::Duration};

pub fn start(e: Arc<Engine>) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(15));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            if e.shutting_down.load(std::sync::atomic::Ordering::SeqCst) {
                break;
            }
            let snapshot = e.store.snapshot();
            if snapshot["schedulerPaused"] == true {
                continue;
            }
            let due: Vec<String> = snapshot["schedules"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|s| {
                    s["enabled"] == true
                        && s["nextRunAt"]
                            .as_i64()
                            .is_some_and(|t| t > 0 && t <= millis())
                })
                .map(|s| text(&s["id"]))
                .collect();
            for id in due {
                let e = e.clone();
                tokio::spawn(async move {
                    if let Err(err) = execute(e.clone(), &id, false).await {
                        e.log("scheduler", "error", &format!("定时任务失败: {err}\n"));
                    }
                });
            }
        }
    });
}
fn event(s: &mut Value, kind: &str, message: &str) {
    let mut history = s["eventHistory"].as_array().cloned().unwrap_or_default();
    history.insert(
        0,
        json!({"id":uuid::Uuid::new_v4().to_string(),"time":now(),"kind":kind,"text":message}),
    );
    history.truncate(20);
    s["eventHistory"] = json!(history);
    s["lastDecision"] = json!(message);
    s["lastDecisionKind"] = json!(kind);
}
fn args(s: &Value) -> Result<Vec<String>> {
    if s["spec"].is_object() {
        jobs::to_args(&s["spec"])
    } else {
        Ok(s["args"]
            .as_array()
            .ok_or("计划缺少任务参数")?
            .iter()
            .map(text)
            .collect())
    }
}
fn range_path(path: &str, start: u64, end: u64) -> String {
    let p = Path::new(path);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("export");
    let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("json");
    p.with_file_name(format!(
        "{stem}_{start}-{end}_{}-{}.{ext}",
        chrono::Local::now().format("%Y%m%d_%H%M%S"),
        &uuid::Uuid::new_v4().to_string()[..8]
    ))
    .to_string_lossy()
    .into()
}
struct Running {
    e: Arc<Engine>,
    id: String,
}
impl Drop for Running {
    fn drop(&mut self) {
        self.e.schedule_running.lock().unwrap().remove(&self.id);
    }
}
pub async fn execute(e: Arc<Engine>, id: &str, manual: bool) -> Result<Value> {
    {
        let mut running = e.schedule_running.lock().unwrap();
        if !running.insert(id.into()) {
            return Err("该计划正在执行".into());
        }
    }
    let _running = Running {
        e: e.clone(),
        id: id.into(),
    };
    let mut s = e.store.snapshot()["schedules"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == id)
        .cloned()
        .ok_or("计划不存在")?;
    if !manual
        && (s["enabled"] != true
            || s["nextRunAt"].as_i64().unwrap_or(i64::MAX) > millis()
            || e.store.snapshot()["schedulerPaused"] == true)
    {
        return Ok(json!({"skipped":true}));
    }
    s["lastCheckedAt"] = json!(now());
    if !manual {
        if s["mode"] == "once" {
            s["enabled"] = json!(false);
            s["nextRunAt"] = json!(0);
        } else {
            s["nextRunAt"] =
                json!(millis() + s["intervalMinutes"].as_i64().unwrap_or(60).max(1) * 60000);
        }
    }
    event(&mut s, "check", "开始检查计划");
    save(&e, &s)?;
    let result = perform(e.clone(), &mut s).await;
    if let Err(err) = &result {
        s["lastStatus"] = json!(format!("执行失败: {err}"));
        event(&mut s, "error", &format!("执行失败: {err}"));
    }
    // Merge runtime fields only. A user disabling/deleting a plan while it runs
    // must never have their edit overwritten when the command completes.
    save_runtime(&e, &s)?;
    result
}
async fn perform(e: Arc<Engine>, s: &mut Value) -> Result<Value> {
    if ["comment-forward", "workflow"].contains(&s["spec"]["kind"].as_str().unwrap_or("")) {
        if s["triggerMode"] == "chat-update" {
            return Err("此流程请使用按时间执行的计划".into());
        }
        run_payload_wait(e, s, json!({"spec":s["spec"]})).await?;
        s["lastRunAt"] = json!(now());
        s["runCount"] = json!(s["runCount"].as_u64().unwrap_or(0) + 1);
        s["lastStatus"] = json!("执行成功");
        event(s, "run-success", "计划执行成功");
        return Ok(json!({"ok":true}));
    }
    let mut command = args(s)?;
    let mut pending = None;
    if s["triggerMode"] == "chat-update" {
        if !["export", "forward"].contains(&s["type"].as_str().unwrap_or("")) {
            return Err("检测更新只支持导出与转发计划".into());
        }
        let latest = e.latest(&text(&s["watchChat"])).await?["latestMessageId"]
            .as_u64()
            .ok_or("无法读取最新消息 ID")?;
        let seen = s["lastSeenMessageId"].as_u64().unwrap_or(0);
        if seen == 0 {
            s["lastSeenMessageId"] = json!(latest);
            s["lastStatus"] = json!(format!("已建立基线: {latest}"));
            event(s, "baseline", "已建立基线，本轮不转发历史消息");
            return Ok(json!({"skipped":true}));
        }
        if latest <= seen {
            s["lastStatus"] = json!(format!("无更新: {latest}"));
            event(s, "skip", "没有新消息");
            return Ok(json!({"skipped":true}));
        }
        let start = seen + 1;
        pending = Some(latest);
        let path = if s["type"] == "export" {
            let old = jobs::arg(&command, &["-o", "--output"]);
            if old.is_empty() {
                return Err("增量导出计划缺少输出路径".into());
            }
            range_path(&old, start, latest)
        } else {
            range_path(
                &e.output.join("incremental.json").to_string_lossy(),
                start,
                latest,
            )
        };
        let export = if s["type"] == "export" {
            jobs::replace_arg(&mut command, &["-T", "--type"], "id".into());
            jobs::replace_arg(
                &mut command,
                &["-i", "--input"],
                format!("{start},{latest}"),
            );
            jobs::replace_arg(&mut command, &["-o", "--output"], path.clone());
            command.clone()
        } else {
            vec![
                "chat".into(),
                "export".into(),
                "-c".into(),
                text(&s["watchChat"]),
                "-T".into(),
                "id".into(),
                "-i".into(),
                format!("{start},{latest}"),
                "--all".into(),
                "--with-content".into(),
                "-o".into(),
                path.clone(),
            ]
        };
        run_wait(e.clone(), s, export).await?;
        if s["type"] == "forward" {
            jobs::replace_arg(&mut command, &["--from"], path);
            run_wait(e.clone(), s, command).await?;
        }
    } else {
        run_wait(e.clone(), s, command).await?;
    }
    if let Some(latest) = pending {
        s["lastSeenMessageId"] = json!(latest);
    }
    s["lastRunAt"] = json!(now());
    s["runCount"] = json!(s["runCount"].as_u64().unwrap_or(0) + 1);
    s["lastStatus"] = json!("执行成功");
    event(s, "run-success", "计划执行成功");
    Ok(json!({"ok":true}))
}
async fn run_wait(e: Arc<Engine>, s: &Value, args: Vec<String>) -> Result<()> {
    run_payload_wait(e, s, json!({"args":args})).await
}
async fn run_payload_wait(e: Arc<Engine>, s: &Value, mut payload: Value) -> Result<()> {
    let id = format!("scheduled_{}", uuid::Uuid::new_v4());
    payload["taskId"] = json!(id);
    let mut task = s["metadata"]
        .as_object()
        .cloned()
        .map(Value::Object)
        .unwrap_or(json!({}));
    task["title"] = json!(format!("{}（定时）", text(&s["name"])));
    task["scheduleId"] = s["id"].clone();
    task["type"] = s["type"].clone();
    payload["task"] = task;
    e.launch(payload).await?;
    loop {
        tokio::time::sleep(Duration::from_millis(100)).await;
        let data = e.store.snapshot();
        let task = data["tasks"]
            .as_array()
            .unwrap()
            .iter()
            .find(|t| t["id"] == id)
            .ok_or("任务记录丢失")?;
        match task["state"].as_str().unwrap_or("") {
            "success" => return Ok(()),
            "failed" | "stopped" | "interrupted" | "partial" => {
                return Err(format!("计划任务未成功: {}", text(&task["errorMessage"])))
            }
            _ => {}
        }
    }
}
fn save(e: &Engine, s: &Value) -> Result<()> {
    e.store.update(|d| {
        let a = d["schedules"].as_array_mut().unwrap();
        if let Some(old) = a.iter_mut().find(|x| x["id"] == s["id"]) {
            *old = s.clone();
        }
        Ok(())
    })?;
    e.changed();
    Ok(())
}
fn save_runtime(e: &Engine, s: &Value) -> Result<()> {
    e.store.update(|d| {
        if let Some(old) = d["schedules"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|x| x["id"] == s["id"])
        {
            for k in [
                "lastCheckedAt",
                "lastSeenMessageId",
                "lastStatus",
                "eventHistory",
                "lastDecision",
                "lastDecisionKind",
                "lastRunAt",
                "runCount",
            ] {
                if let Some(v) = s.get(k) {
                    old[k] = v.clone();
                }
            }
        }
        Ok(())
    })?;
    e.changed();
    Ok(())
}
