use crate::{
    comments,
    filter::{self, Filter},
    jobs, millis, now,
    store::{read_json, write_json, Store},
    text, Result,
};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::Command,
    sync::Semaphore,
};
use tokio_util::sync::CancellationToken;

pub type Sink = Arc<dyn Fn(&str, Value) + Send + Sync>;
pub struct Engine {
    pub store: Store,
    pub output: PathBuf,
    sink: Sink,
    active: Mutex<HashMap<String, CancellationToken>>,
    commands: Mutex<HashMap<u32, CancellationToken>>,
    slots: Arc<Semaphore>,
    pub shutting_down: AtomicBool,
    pub schedule_running: Mutex<std::collections::HashSet<String>>,
    cache_lock: tokio::sync::Mutex<()>,
    comment_active: AtomicBool,
}
impl Engine {
    pub fn new(root: PathBuf, output: PathBuf, sink: Sink) -> Result<Arc<Self>> {
        let store = Store::open(root)?;
        let c = store.config(&output)?;
        let n = c["maxConcurrentTasks"].as_u64().unwrap_or(2).clamp(1, 8) as usize;
        Ok(Arc::new(Self {
            store,
            output,
            sink,
            active: Mutex::new(HashMap::new()),
            commands: Mutex::new(HashMap::new()),
            slots: Arc::new(Semaphore::new(n)),
            shutting_down: AtomicBool::new(false),
            schedule_running: Mutex::new(Default::default()),
            cache_lock: tokio::sync::Mutex::new(()),
            comment_active: AtomicBool::new(false),
        }))
    }
    pub fn emit(&self, event: &str, data: Value) {
        (self.sink)(event, data);
    }
    pub fn changed(&self) {
        self.emit("runtime:snapshot", self.store.snapshot());
    }
    pub fn config(&self) -> Result<Value> {
        self.store.config(&self.output)
    }
    pub fn log(&self, id: &str, level: &str, s: &str) {
        if s.is_empty() {
            return;
        }
        let dir = self.store.root.join("logs");
        let _ = fs::create_dir_all(&dir);
        let file = dir.join(format!("{}.log", safe_id(id)));
        if fs::metadata(&file)
            .map(|s| s.len() > 4 * 1024 * 1024)
            .unwrap_or(false)
        {
            let _ = fs::rename(&file, file.with_extension("previous.log"));
        }
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(file) {
            let _ = f.write_all(s.as_bytes());
        }
        self.emit("tdl:log", json!({"taskId":id,"level":level,"text":s}));
    }
    pub fn stop(&self, id: &str) -> Value {
        if let Some(token) = self.active.lock().unwrap().get(id) {
            token.cancel();
            json!({"ok":true,"message":"已请求停止任务"})
        } else {
            json!({"ok":false,"message":"任务不在运行中或已结束"})
        }
    }
    pub fn stop_all(&self) {
        for t in self.active.lock().unwrap().values() {
            t.cancel();
        }
        for t in self.commands.lock().unwrap().values() {
            t.cancel();
        }
    }
    pub fn has_processes(&self) -> bool {
        !self.commands.lock().unwrap().is_empty()
    }
    pub fn stop_comments(&self) -> Value {
        let data = self.store.snapshot();
        let id = data["tasks"]
            .as_array()
            .unwrap()
            .iter()
            .find(|t| {
                t["type"] == "comment-forward"
                    && ["running", "queued"].contains(&t["state"].as_str().unwrap_or(""))
            })
            .map(|t| text(&t["id"]));
        id.map(|id| self.stop(&id))
            .unwrap_or(json!({"ok":false,"message":"当前没有正在运行的评论区转发任务"}))
    }
    pub async fn launch(self: &Arc<Self>, payload: Value) -> Result<Value> {
        if self.shutting_down.load(Ordering::SeqCst) {
            return Err("应用正在退出".into());
        }
        let id = payload["taskId"]
            .as_str()
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| format!("task_{}", uuid::Uuid::new_v4()));
        if safe_id(&id) != id || id.len() > 160 {
            return Err("任务 ID 无效".into());
        }
        let spec = payload["spec"].clone();
        let comment = spec["kind"] == "comment-forward";
        let workflow = spec["kind"] == "workflow";
        if workflow {
            let steps = spec["steps"].as_array().ok_or("流程缺少执行步骤")?;
            if steps.is_empty() || steps.len() > 1024 {
                return Err("流程需包含 1–1024 个步骤".into());
            }
            for step in steps {
                jobs::to_args(step)?;
            }
        }
        let args = if spec.is_object() && !comment && !workflow {
            jobs::to_args(&spec)?
        } else {
            payload["args"]
                .as_array()
                .unwrap_or(&vec![])
                .iter()
                .map(text)
                .collect()
        };
        if !comment && !workflow && args.is_empty() {
            return Err("任务参数为空".into());
        }
        let config = self.config()?;
        let mut effective = config.clone();
        if let Some(filters) = spec["filterConfig"].as_object() {
            for key in [
                "blockKeywordsText",
                "keywordCaseSensitive",
                "keywordRegexMode",
            ] {
                if let Some(value) = filters.get(key) {
                    effective[key] = value.clone();
                }
            }
        }
        if comment {
            for (k, v) in spec.as_object().unwrap() {
                effective[k] = v.clone();
            }
        }
        if comment {
            comments::validate(&effective)?;
        }
        let work = if comment {
            Some(comments::work_dir(&effective, &self.output))
        } else {
            None
        };
        let token = CancellationToken::new();
        {
            let mut active = self.active.lock().unwrap();
            if active.contains_key(&id) {
                return Err("相同任务正在运行".into());
            }
            if active.len() >= 100 {
                return Err("队列已满，请等待现有任务结束".into());
            }
            if comment && self.comment_active.swap(true, Ordering::SeqCst) {
                return Err("已有评论区转发任务正在运行".into());
            }
            active.insert(id.clone(), token.clone());
        }
        let mut task = payload["task"]
            .as_object()
            .cloned()
            .map(Value::Object)
            .unwrap_or(json!({}));
        task["id"] = json!(id);
        task["type"] = json!(if comment {
            "comment-forward".into()
        } else {
            spec["kind"]
                .as_str()
                .or(payload["task"]["type"].as_str())
                .unwrap_or_else(|| args.first().map(String::as_str).unwrap_or("task"))
                .to_owned()
        });
        task["args"] = json!(args);
        task["spec"] = spec.clone();
        if let Some(path) = &work {
            task["workDir"] = json!(path);
        }
        task["state"] = json!("queued");
        task["status"] = json!("排队中");
        task["createdAt"] = json!(now());
        if task["title"].is_null() {
            task["title"] = task["type"].clone();
        }
        let saved = self.store.update(|d| {
            let tasks = d["tasks"].as_array_mut().unwrap();
            tasks.retain(|t| t["id"] != id);
            tasks.insert(0, task);
            let mut terminal = 0;
            tasks.retain(|t| {
                if ["running", "queued"].contains(&t["state"].as_str().unwrap_or("")) {
                    true
                } else {
                    terminal += 1;
                    terminal <= 100
                }
            });
            Ok(())
        });
        if let Err(e) = saved {
            self.active.lock().unwrap().remove(&id);
            if comment {
                self.comment_active.store(false, Ordering::SeqCst);
            }
            return Err(e);
        }
        self.changed();
        let e = self.clone();
        let task_id = id.clone();
        let cwd = work.clone();
        let response_args = args.clone();
        tokio::spawn(async move {
            let acquired = tokio::select! {p=e.slots.clone().acquire_owned()=>p.ok(),_=token.cancelled()=>None};
            let result = if let Some(_permit) = acquired {
                if token.is_cancelled() {
                    Err("任务已停止".into())
                } else {
                    let _ = e.store.task(
                        &task_id,
                        json!({"state":"running","status":"运行中","startedAt":now()}),
                    );
                    e.changed();
                    if comment {
                        comments::run(
                            e.clone(),
                            &task_id,
                            &effective,
                            cwd.as_ref().unwrap(),
                            &token,
                        )
                        .await
                    } else if workflow {
                        e.run_workflow(&task_id, &spec, &effective, &token).await
                    } else {
                        e.run_filtered(&task_id, &args, &effective, &token).await
                    }
                }
            } else {
                Err("任务已停止".into())
            };
            let stopped = token.is_cancelled();
            let code = if stopped {
                130
            } else {
                result
                    .as_ref()
                    .map(|v| v["code"].as_i64().unwrap_or(0))
                    .unwrap_or(-1)
            };
            let err = result.as_ref().err().cloned().unwrap_or_else(|| {
                result
                    .as_ref()
                    .ok()
                    .map(|v| text(&v["errorTail"]))
                    .unwrap_or_default()
            });
            let failed_count = result
                .as_ref()
                .ok()
                .and_then(|v| v["failedCount"].as_u64())
                .unwrap_or(0);
            let state = if stopped {
                "stopped"
            } else if code != 0 {
                "failed"
            } else if failed_count > 0 {
                "partial"
            } else {
                "success"
            };
            let label = match state {
                "stopped" => "已停止",
                "failed" => "失败",
                "partial" => "部分成功",
                _ => "成功",
            };
            if let Err(storage_error)=e.store.task(&task_id,json!({"state":state,"status":label,"finishedAt":now(),"exitCode":code,"errorMessage":err,"failedCount":failed_count})){
                e.emit("runtime:error",json!(storage_error));
            }
            e.active.lock().unwrap().remove(&task_id);
            if comment {
                e.comment_active.store(false, Ordering::SeqCst);
            }
            e.log(
                &task_id,
                if code == 0 { "info" } else { "error" },
                &format!("\n[任务结束] {label}，exit code: {code}\n"),
            );
            if comment {
                e.emit("comment-forward:status",json!({"taskId":task_id,"status":if stopped{"stopped"}else if code==0{"done"}else{"error"},"message":err,"workDir":cwd}));
            }
            e.changed();
            e.emit("tdl:done",json!({"taskId":task_id,"code":code,"stopped":stopped,"errorTail":err,"failedCount":failed_count}));
        });
        Ok(
            json!({"ok":true,"taskId":id,"args":response_args,"workDir":work,"message":"任务已加入后台队列"}),
        )
    }
    async fn run_filtered(
        self: &Arc<Self>,
        id: &str,
        args: &[String],
        c: &Value,
        token: &CancellationToken,
    ) -> Result<Value> {
        let mut args = args.to_vec();
        let temp = tempfile::tempdir().map_err(|e| e.to_string())?;
        if args.first().map(String::as_str) == Some("forward") {
            let from = jobs::arg(&args, &["--from"]);
            if from.is_empty() {
                return Err("转发任务缺少源文件".into());
            }
            let filter = Filter::new(c)?;
            if from.starts_with("https://t.me/") || from.starts_with("https://telegram.me/") {
                if filter.enabled {
                    return Err(
                        "消息链接需要先导出为 JSON 才能应用过滤规则，请使用工作台的频道搬运流程"
                            .into(),
                    );
                }
            } else {
                let result = filter.file(Path::new(&from), &temp.path().join("filtered.json"))?;
                self.log(
                    id,
                    "info",
                    &format!(
                        "[过滤] 删除 {} 条，保留 {} 条\n",
                        result["removed"], result["count"]
                    ),
                );
                if result["count"] == 0 {
                    self.log(id, "warning", "消息为空，已跳过转发\n");
                    return Ok(json!({"code":0,"skipped":true}));
                }
                jobs::replace_arg(&mut args, &["--from"], text(&result["file"]));
            }
        }
        let output = jobs::arg(&args, &["-o", "--output"]);
        if args.get(1).map(String::as_str) == Some("export") && !output.is_empty() {
            if let Some(p) = Path::new(&output).parent() {
                if !p.as_os_str().is_empty() {
                    fs::create_dir_all(p).map_err(|e| e.to_string())?;
                }
            }
        }
        let result = self.command(id, &args, c, None, token, false).await?;
        Ok(
            json!({"code":result.code,"errorTail":if result.code==0 {String::new()}else{result.error()}}),
        )
    }
    async fn run_workflow(
        self: &Arc<Self>,
        id: &str,
        spec: &Value,
        config: &Value,
        token: &CancellationToken,
    ) -> Result<Value> {
        let steps = spec["steps"].as_array().ok_or("流程缺少步骤")?;
        for (index, step) in steps.iter().enumerate() {
            if token.is_cancelled() {
                return Err("任务已停止".into());
            }
            self.store
                .task(id, json!({"currentStep":index + 1,"stepTotal":steps.len()}))?;
            self.changed();
            self.log(
                id,
                "info",
                &format!(
                    "\n[流程 {}/{}] {}\n",
                    index + 1,
                    steps.len(),
                    text(&step["kind"])
                ),
            );
            let result = self
                .run_filtered(id, &jobs::to_args(step)?, config, token)
                .await?;
            if result["code"] != 0 {
                return Ok(result);
            }
        }
        Ok(json!({"code":0}))
    }
    pub async fn command(
        self: &Arc<Self>,
        id: &str,
        args: &[String],
        c: &Value,
        cwd: Option<&Path>,
        token: &CancellationToken,
        capture: bool,
    ) -> Result<CommandOutput> {
        if token.is_cancelled() {
            return Err("任务已停止".into());
        }
        let mut all = jobs::global_args(c);
        all.extend_from_slice(args);
        let bin = tdl_path(c);
        self.log(
            id,
            "info",
            &format!(
                "$ {} {}\n",
                bin,
                all.iter()
                    .map(|s| if s.chars().any(char::is_whitespace) {
                        json!(s).to_string()
                    } else {
                        s.clone()
                    })
                    .collect::<Vec<_>>()
                    .join(" ")
            ),
        );
        let mut command = Command::new(&bin);
        command
            .args(all)
            .env("PATH", path_env())
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        if let Some(cwd) = cwd {
            command.current_dir(cwd);
        }
        #[cfg(unix)]
        command.process_group(0);
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        let mut child = command
            .spawn()
            .map_err(|e| format!("启动 tdl 失败 ({bin}): {e}"))?;
        let pid = child.id();
        if let Some(pid) = pid {
            self.commands.lock().unwrap().insert(pid, token.clone());
        }
        let _lease = ProcessLease {
            engine: self.clone(),
            pid,
        };
        if self.shutting_down.load(Ordering::SeqCst) {
            token.cancel();
        }
        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();
        let e = self.clone();
        let task = id.to_owned();
        let reader_token = token.clone();
        let out = tokio::spawn(async move {
            read_stream(e, task, "stdout", stdout, capture, reader_token).await
        });
        let e = self.clone();
        let task = id.to_owned();
        let reader_token = token.clone();
        let err = tokio::spawn(async move {
            read_stream(e, task, "stderr", stderr, false, reader_token).await
        });
        let status = tokio::select! {
            s=child.wait()=>s.map_err(|e|e.to_string()),
            _=token.cancelled()=>{
                #[cfg(unix)] if let Some(pid)=pid{unsafe{libc::kill(-(pid as i32),libc::SIGKILL);}}
                #[cfg(windows)] if let Some(pid)=pid{let _=Command::new("taskkill").args(["/PID",&pid.to_string(),"/F","/T"]).output().await;}
                let _=child.kill().await;let _=child.wait().await;Err("任务已停止".into())
            }
        };
        let stdout = out.await.map_err(|e| e.to_string())??;
        let stderr = err.await.map_err(|e| e.to_string())??;
        Ok(CommandOutput {
            code: status?.code().unwrap_or(1),
            stdout,
            stderr,
        })
    }
    pub async fn latest(self: &Arc<Self>, chat: &str) -> Result<Value> {
        if chat.trim().is_empty() {
            return Err("频道为空".into());
        }
        let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
        let file = dir.path().join("latest.json");
        let args = vec![
            "chat".into(),
            "export".into(),
            "-c".into(),
            chat.into(),
            "-T".into(),
            "last".into(),
            "-i".into(),
            "1".into(),
            "--all".into(),
            "--with-content".into(),
            "-o".into(),
            file.to_string_lossy().into(),
        ];
        let token = CancellationToken::new();
        let result = timed(
            self.command("chat-check", &args, &self.config()?, None, &token, false),
            &token,
            60,
        )
        .await?;
        if result.code != 0 {
            return Err(result.error());
        }
        let analysis = filter::analyze(&file);
        if analysis["ok"] != true {
            return Err(text(&analysis["reason"]));
        }
        Ok(json!({"ok":true,"chat":chat,"latestMessageId":analysis["maxId"],"checkedAt":now()}))
    }
    pub async fn chat_cache(self: &Arc<Self>, action: &str, filter: &str) -> Result<Value> {
        let _guard = self.cache_lock.lock().await;
        let config = self.config()?;
        let ns = text(&config["ns"]);
        let file = self.store.root.join("chats-cache.json");
        let mut cache = if file.exists() {
            read_json(&file)?
        } else {
            json!({"version":1,"caches":{}})
        };
        let current = &cache["caches"][&ns];
        let updated = current["updatedAt"].as_i64().unwrap_or(0);
        let days = config["chatCacheDays"].as_f64().unwrap_or(7.0).max(1.0);
        let expired = updated == 0 || (millis() - updated) as f64 > days * 86400000.0;
        if action == "refresh" || action == "list" || action == "ensure" && expired {
            let mut args = vec!["chat".into(), "ls".into(), "-o".into(), "json".into()];
            if !filter.is_empty() {
                args.extend(["--filter".into(), filter.into()]);
            }
            let token = CancellationToken::new();
            let result = timed(
                self.command("chat-cache", &args, &config, None, &token, true),
                &token,
                60,
            )
            .await?;
            if result.code != 0 {
                return Err(result.error());
            }
            let parsed: Value = serde_json::from_str(&result.stdout)
                .map_err(|e| format!("对话列表 JSON 无效: {e}"))?;
            let chats = if parsed.is_array() {
                parsed
            } else {
                parsed
                    .get("dialogs")
                    .or_else(|| parsed.get("items"))
                    .filter(|v| v.is_array())
                    .cloned()
                    .unwrap_or(json!([]))
            };
            if action == "list" && !filter.is_empty() {
                return Ok(json!({"chats":chats,"count":chats.as_array().unwrap().len()}));
            }
            cache["caches"][&ns] = json!({"ns":ns,"updatedAt":millis(),"chats":chats});
            write_json(&file, &cache)?;
        }
        let current = &cache["caches"][&ns];
        let chats = current["chats"].as_array().cloned().unwrap_or_default();
        let updated = current["updatedAt"].as_i64().unwrap_or(0);
        Ok(
            json!({"ns":ns,"chats":chats,"count":chats.len(),"updatedAt":updated,"updatedAtText":if updated>0{chrono::DateTime::from_timestamp_millis(updated).unwrap().to_rfc3339()}else{String::new()},"ttlDays":days,"expired":updated==0||(millis()-updated)as f64>days*86400000.0,"cacheFile":file}),
        )
    }
}
pub fn safe_id(id: &str) -> String {
    id.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect()
}
pub fn tdl_path(c: &Value) -> String {
    let configured = text(&c["tdlPath"]);
    if !configured.trim().is_empty() && configured.trim() != "tdl" {
        return configured.trim().into();
    }
    for p in [
        "/opt/homebrew/bin/tdl",
        "/usr/local/bin/tdl",
        "/usr/bin/tdl",
        "/bin/tdl",
    ] {
        if Path::new(p).is_file() {
            return p.into();
        }
    }
    "tdl".into()
}
fn path_env() -> std::ffi::OsString {
    let current = std::env::var_os("PATH").unwrap_or_default();
    let mut paths: Vec<_> = std::env::split_paths(&current).collect();
    #[cfg(unix)]
    for p in [
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/usr/local/sbin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
    ] {
        if !paths.contains(&PathBuf::from(p)) {
            paths.push(p.into());
        }
    }
    std::env::join_paths(paths).unwrap_or(current)
}
pub struct CommandOutput {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}
struct ProcessLease {
    engine: Arc<Engine>,
    pid: Option<u32>,
}
impl Drop for ProcessLease {
    fn drop(&mut self) {
        if let Some(pid) = self.pid {
            self.engine.commands.lock().unwrap().remove(&pid);
        }
    }
}
impl CommandOutput {
    pub fn error(&self) -> String {
        format!(
            "退出码 {}: {}",
            self.code,
            if self.stderr.trim().is_empty() {
                self.stdout.trim()
            } else {
                self.stderr.trim()
            }
        )
    }
}
async fn read_stream<R: AsyncRead + Unpin>(
    e: Arc<Engine>,
    id: String,
    level: &str,
    mut reader: R,
    capture: bool,
    token: CancellationToken,
) -> Result<String> {
    let mut bytes = [0u8; 16384];
    let mut pending = Vec::new();
    let mut batch = String::new();
    let mut saved = String::new();
    let mut interval = tokio::time::interval(Duration::from_millis(120));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            n=reader.read(&mut bytes)=>{let n=n.map_err(|e|e.to_string())?;
                if n==0 {if !pending.is_empty(){batch.push_str(&String::from_utf8_lossy(&pending));}break;}
                pending.extend_from_slice(&bytes[..n]);
                let valid=match std::str::from_utf8(&pending){Ok(_)=>pending.len(),Err(err)=>if err.error_len().is_none(){err.valid_up_to()}else{pending.len()}};
                let s=String::from_utf8_lossy(&pending[..valid]);batch.push_str(&s);saved.push_str(&s);pending.drain(..valid);
                if capture && saved.len()>16*1024*1024{token.cancel();return Err("对话列表超过 16 MB，请使用过滤条件缩小范围".into());}
                if !capture{trim_tail(&mut saved,32768);}
                if batch.len()>=65536{e.log(&id,level,&batch);batch.clear();}
            }
            _=interval.tick()=>{if !batch.is_empty(){e.log(&id,level,&batch);batch.clear();}}
        }
    }
    if !batch.is_empty() {
        e.log(&id, level, &batch);
    }
    Ok(saved)
}
fn trim_tail(s: &mut String, limit: usize) {
    if s.len() > limit {
        let mut n = s.len() - limit;
        while !s.is_char_boundary(n) {
            n += 1;
        }
        s.drain(..n);
    }
}
pub async fn timed<T>(
    future: impl std::future::Future<Output = Result<T>>,
    token: &CancellationToken,
    seconds: u64,
) -> Result<T> {
    tokio::pin!(future);
    tokio::select! {v=&mut future=>v,_=tokio::time::sleep(Duration::from_secs(seconds))=>{token.cancel();let _=future.await;Err("检查超时".into())}}
}
