use crate::{
    engine::Engine,
    filter::{message_ids, Filter},
    now,
    store::{read_json, write_json},
    text, Result,
};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tokio_util::sync::CancellationToken;
fn yes(c: &Value, k: &str) -> bool {
    c[k] != false
}
pub fn work_dir(c: &Value, output: &Path) -> PathBuf {
    let dir = if !text(&c["workDir"]).trim().is_empty() {
        PathBuf::from(text(&c["workDir"]))
    } else {
        let base = if !text(&c["baseOutputDir"]).is_empty() {
            PathBuf::from(text(&c["baseOutputDir"]))
        } else if !text(&c["defaultDownloadDir"]).is_empty() {
            PathBuf::from(text(&c["defaultDownloadDir"]))
        } else {
            output.to_owned()
        };
        base.join("comment-forward").join(format!(
            "{}-{}",
            chrono::Local::now().format("%Y%m%d-%H%M%S"),
            &uuid::Uuid::new_v4().to_string()[..8]
        ))
    };
    // Match the original worker's path.resolve before using this as the
    // subprocess cwd; relative output paths would otherwise be nested twice.
    if dir.is_absolute() {
        dir
    } else {
        std::env::current_dir().unwrap_or_default().join(dir)
    }
}
pub fn validate(c: &Value) -> Result<()> {
    if text(&c["sourceChat"]).trim().is_empty() {
        return Err("请填写源频道 / 群组".into());
    }
    if c["exportOnly"] != true
        && c["dryRun"] != true
        && (yes(c, "forwardMain") || yes(c, "forwardComments"))
        && text(&c["targetChat"]).trim().is_empty()
    {
        return Err("需要转发时，请填写目标频道 / 群组".into());
    }
    if let (Some(a), Some(b)) = (c["startId"].as_u64(), c["endId"].as_u64()) {
        if b > 0 && a > b {
            return Err("起始 ID 不能大于结束 ID".into());
        }
    }
    Ok(())
}
struct Worker<'a> {
    e: Arc<Engine>,
    id: &'a str,
    c: &'a Value,
    dir: &'a Path,
    token: &'a CancellationToken,
    filter: Filter,
}
impl Worker<'_> {
    fn progress(&self, current: usize, total: usize, id: u64, stage: &str) {
        self.e.emit(
            "comment-forward:progress",
            json!({"taskId":self.id,"current":current,"total":total,"id":id,"stage":stage}),
        );
    }
    async fn export(&self, file: &Path, selector: Vec<String>, initial: bool) -> Result<()> {
        if self.c["skipExistingExport"] == true && file.is_file() {
            return Ok(());
        }
        if self.c["dryRun"] == true && !initial {
            self.e.log(self.id, "warning", "[演练模式] 跳过导出\n");
            return Ok(());
        }
        let mut args = vec![
            "chat".into(),
            "export".into(),
            "-c".into(),
            text(&self.c["sourceChat"]),
        ];
        args.extend(selector);
        args.extend([
            "--all".into(),
            "--with-content".into(),
            "-o".into(),
            file.to_string_lossy().into(),
        ]);
        let output = self
            .e
            .command(self.id, &args, self.c, Some(self.dir), self.token, false)
            .await?;
        if output.code != 0 {
            return Err(output.error());
        }
        Ok(())
    }
    async fn forward(&self, file: &Path) -> Result<()> {
        if self.c["exportOnly"] == true || self.c["dryRun"] == true {
            self.e.log(self.id, "info", "[仅导出/演练] 跳过实际转发\n");
            return Ok(());
        }
        let peer = text(&self.c["targetChat"]);
        let topic = text(&self.c["targetTopicId"]);
        let destination = if topic.is_empty() || topic == "0" {
            peer.clone()
        } else {
            let thread = topic
                .parse::<u64>()
                .map_err(|_| "目标话题 ID 必须是非负整数")?;
            let router = self.dir.join("target_router.txt");
            std::fs::write(
                &router,
                format!("{{ Peer: {}, Thread: {thread} }}", json!(peer)),
            )
            .map_err(|e| e.to_string())?;
            router.to_string_lossy().into_owned()
        };
        let mut args = vec![
            "forward".into(),
            "--from".into(),
            file.to_string_lossy().into(),
            "--to".into(),
            destination,
            "--mode".into(),
            self.c["mode"].as_str().unwrap_or("direct").into(),
        ];
        let output = self
            .e
            .command(self.id, &args, self.c, Some(self.dir), self.token, false)
            .await?;
        if output.code != 0 {
            if !topic.is_empty()
                && topic != "0"
                && output.error().contains("MSG_ID_INVALID")
                && yes(self.c, "fallbackToDefaultTopicOnMsgIdInvalid")
            {
                self.e.log(
                    self.id,
                    "warning",
                    "话题返回 MSG_ID_INVALID，改为目标群默认聊天\n",
                );
                args[4] = peer;
                let output = self
                    .e
                    .command(self.id, &args, self.c, Some(self.dir), self.token, false)
                    .await?;
                if output.code != 0 {
                    return Err(output.error());
                }
            } else {
                return Err(output.error());
            }
        }
        Ok(())
    }
    async fn group(&self, id: u64, index: usize, total: usize) -> Result<()> {
        let post = self.dir.join(format!("queue/post_{id}.json"));
        let comments = self.dir.join(format!("comments/comments_{id}.json"));
        self.progress(index, total, id, "export-post");
        self.export(
            &post,
            vec!["-T".into(), "id".into(), "-i".into(), format!("{id},{id}")],
            false,
        )
        .await?;
        // Dry-run still obtains the real list, but must not fabricate per-post
        // checkpoints that would cause a later real run to skip messages.
        if self.c["dryRun"] == true {
            return Ok(());
        }
        let pf = self.filter.file(
            &post,
            &self.dir.join(format!("filtered/post_{id}.filtered.json")),
        )?;
        let post_count = pf["count"].as_u64().unwrap_or(0);
        let blocked = pf["removed"].as_u64().unwrap_or(0) > 0 && post_count == 0;
        let need_comments = yes(self.c, "includeComments")
            && (yes(self.c, "forwardComments") || self.c["skipPostWhenNoComments"] == true);
        let mut cf = None;
        if need_comments && !(blocked && yes(self.c, "skipCommentsWhenPostBlocked")) {
            self.progress(index, total, id, "export-comments");
            self.export(&comments, vec!["--reply".into(), id.to_string()], false)
                .await?;
            cf = Some(
                self.filter.file(
                    &comments,
                    &self
                        .dir
                        .join(format!("filtered/comments_{id}.filtered.json")),
                )?,
            );
        }
        let count = cf.as_ref().and_then(|v| v["count"].as_u64()).unwrap_or(0);
        if self.c["skipPostWhenNoComments"] == true && count == 0 {
            self.e.log(
                self.id,
                "info",
                &format!("主消息 {id} 没有可用评论，跳过整组\n"),
            );
            return Ok(());
        }
        if post_count > 0 && yes(self.c, "forwardMain") {
            self.progress(index, total, id, "forward-post");
            self.forward(Path::new(&text(&pf["file"]))).await?;
        }
        if count > 0 && yes(self.c, "forwardComments") {
            self.progress(index, total, id, "forward-comments");
            self.forward(Path::new(&text(&cf.unwrap()["file"]))).await?;
        }
        Ok(())
    }
}
pub async fn run(
    e: Arc<Engine>,
    id: &str,
    c: &Value,
    dir: &Path,
    token: &CancellationToken,
) -> Result<Value> {
    for sub in ["", "queue", "comments", "filtered"] {
        std::fs::create_dir_all(dir.join(sub)).map_err(|e| e.to_string())?;
    }
    let w = Worker {
        e: e.clone(),
        id,
        c,
        dir,
        token,
        filter: Filter::new(c)?,
    };
    e.emit(
        "comment-forward:status",
        json!({"taskId":id,"status":"running","workDir":dir}),
    );
    let file = dir.join("progress.json");
    let mut progress = if c["resume"] == true && file.exists() {
        read_json(&file)?
    } else {
        json!({"done":{},"failed":{}})
    };
    if !progress["done"].is_object() || !progress["failed"].is_object() {
        return Err("progress.json 格式无效".into());
    }
    let start = c["startId"].as_u64().unwrap_or(0);
    let end = c["endId"].as_u64().unwrap_or(0);
    let selector = if start > 0 || end > 0 {
        vec![
            "-T".into(),
            "id".into(),
            "-i".into(),
            format!(
                "{},{}",
                start,
                if end > 0 {
                    end
                } else {
                    9_223_372_036_854_775_807
                }
            ),
        ]
    } else {
        vec![]
    };
    let posts = dir.join("posts.json");
    w.export(&posts, selector, true).await?;
    let mut ids = message_ids(&read_json(&posts)?);
    ids.retain(|i| *i >= start && (end == 0 || *i <= end));
    if c["desc"] == true {
        ids.reverse();
    }
    for (index, post_id) in ids.iter().enumerate() {
        if token.is_cancelled() {
            return Err("任务已停止".into());
        }
        let key = post_id.to_string();
        if !progress["done"][&key].is_null() {
            w.progress(index + 1, ids.len(), *post_id, "skipped");
            continue;
        }
        let result = w.group(*post_id, index + 1, ids.len()).await;
        if token.is_cancelled() {
            return Err("任务已停止".into());
        }
        match result {
            Ok(()) => {
                if c["dryRun"] != true {
                    progress["done"][&key] = json!({"id":post_id,"doneAt":now()});
                    progress["failed"].as_object_mut().unwrap().remove(&key);
                }
                w.progress(index + 1, ids.len(), *post_id, "done");
            }
            Err(err) => {
                progress["failed"][&key] = json!({"id":post_id,"error":err,"failedAt":now()});
                progress["updatedAt"] = json!(now());
                write_json(&file, &progress)?;
                w.progress(index + 1, ids.len(), *post_id, "failed");
                e.log(id, "error", &format!("消息 {post_id} 处理失败: {err}\n"));
                if !yes(c, "continueOnError") {
                    return Err(err);
                }
            }
        }
        if c["dryRun"] != true {
            progress["updatedAt"] = json!(now());
            write_json(&file, &progress)?;
        }
        let delay = c["delayMs"].as_u64().unwrap_or(1500);
        tokio::select! {_=tokio::time::sleep(Duration::from_millis(delay))=>{},_=token.cancelled()=>return Err("任务已停止".into())}
    }
    Ok(json!({"code":0,"failedCount":progress["failed"].as_object().unwrap().len()}))
}
pub fn progress_summary(dir: &Path) -> Value {
    let file = dir.join("progress.json");
    let result = (|| -> Result<Value> {
        let p = read_json(&file)?;
        let mut failed: Vec<Value> = p["failed"]
            .as_object()
            .map(|m| m.values().cloned().collect())
            .unwrap_or_default();
        failed.sort_by_key(|x| x["id"].as_u64().unwrap_or(0));
        Ok(
            json!({"ok":true,"filePath":file,"updatedAt":p["updatedAt"],"doneCount":p["done"].as_object().map(|m|m.len()).unwrap_or(0),"totalCount":read_json(&dir.join("posts.json")).map(|v|message_ids(&v).len()).unwrap_or(0),"failedCount":failed.len(),"failedIds":failed.iter().map(|x|x["id"].clone()).collect::<Vec<_>>(),"failedItems":failed}),
        )
    })();
    result.unwrap_or_else(|err| json!({"ok":false,"reason":err,"filePath":file}))
}
