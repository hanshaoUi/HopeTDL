use crate::{
    comments,
    engine::{self, Engine},
    filter, now, scheduler,
    store::{read_json, write_json},
    text, Result,
};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{atomic::Ordering, Arc},
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};
use tauri_plugin_opener::OpenerExt;
use tokio_util::sync::CancellationToken;

#[tauri::command]
async fn request(
    app: tauri::AppHandle,
    engine: tauri::State<'_, Arc<Engine>>,
    channel: String,
    payload: Option<Value>,
) -> Result<Value> {
    let e = engine.inner().clone();
    let p = payload.unwrap_or(Value::Null);
    match channel.as_str() {
        "config:get" => e.config(),
        "config:set" => {
            if !p.is_object() {
                return Err("配置必须是对象".into());
            }
            write_json(&e.store.root.join("config.json"), &p)?;
            e.config()
        }
        "path:defaultOutputDir" => {
            fs::create_dir_all(&e.output).map_err(|e| e.to_string())?;
            Ok(json!(e.output))
        }
        "runtime:get" => Ok(e.store.snapshot()),
        "runtime:preference" => {
            let key = p["key"].as_str().ok_or("缺少存储键")?;
            if !key.starts_with("hopetdl.") && !["theme", "showLog"].contains(&key) {
                return Err("未知偏好设置".into());
            }
            if !p["value"].is_string() && !p["value"].is_null() {
                return Err("偏好设置必须是字符串".into());
            }
            e.store.update(|d| {
                if p["value"].is_null() {
                    d["preferences"].as_object_mut().unwrap().remove(key);
                } else {
                    d["preferences"][key] = p["value"].clone();
                }
                Ok(())
            })?;
            Ok(json!(true))
        }
        "runtime:schedule" => {
            let id = p["id"].as_str().ok_or("缺少计划 ID")?;
            let result = e.store.update(|d| {
                let a = d["schedules"].as_array_mut().unwrap();
                match p["action"].as_str().unwrap_or("") {
                    "delete" => a.retain(|s| s["id"] != id),
                    "upsert" => {
                        let patch = p["schedule"].as_object().ok_or("缺少计划内容")?;
                        if patch.get("id") != Some(&json!(id)) {
                            return Err("计划 ID 不一致".into());
                        }
                        if let Some(old) = a.iter_mut().find(|s| s["id"] == id) {
                            for (k, v) in patch {
                                if [
                                    "name",
                                    "enabled",
                                    "mode",
                                    "runAt",
                                    "intervalMinutes",
                                    "nextRunAt",
                                    "triggerMode",
                                    "watchChat",
                                    "args",
                                    "spec",
                                ]
                                .contains(&k.as_str())
                                {
                                    old[k] = v.clone();
                                }
                            }
                        } else {
                            if a.len() >= 100 {
                                return Err("最多保留 100 个计划".into());
                            }
                            a.insert(0, Value::Object(patch.clone()));
                        }
                    }
                    _ => return Err("未知计划操作".into()),
                }
                Ok(())
            });
            e.changed();
            result?;
            Ok(e.store.snapshot())
        }
        "runtime:runSchedule" => scheduler::execute(e, &text(&p), true).await,
        "runtime:clearFinished" => {
            e.store.update(|d| {
                d["tasks"]
                    .as_array_mut()
                    .unwrap()
                    .retain(|t| ["queued", "running"].contains(&t["state"].as_str().unwrap_or("")));
                Ok(())
            })?;
            e.changed();
            Ok(json!(true))
        }
        "runtime:taskMetadata" => {
            let mut patch = json!({});
            for k in ["failedCount", "failedIds"] {
                if let Some(v) = p.get(k) {
                    patch[k] = v.clone();
                }
            }
            e.store.task(&text(&p["id"]), patch)?;
            e.changed();
            Ok(json!(true))
        }
        "runtime:pause" => {
            e.store.update(|d| {
                d["schedulerPaused"] = json!(p == true);
                Ok(())
            })?;
            e.changed();
            Ok(json!(true))
        }
        "runtime:logTail" => {
            use std::io::{Read, Seek, SeekFrom};
            let id = text(&p);
            if engine::safe_id(&id) != id {
                return Err("任务 ID 无效".into());
            }
            let file = e.store.root.join("logs").join(format!("{id}.log"));
            let value = if let Ok(mut f) = fs::File::open(file) {
                let len = f.metadata().map_err(|e| e.to_string())?.len();
                f.seek(SeekFrom::Start(len.saturating_sub(32768)))
                    .map_err(|e| e.to_string())?;
                let mut b = vec![];
                f.read_to_end(&mut b).map_err(|e| e.to_string())?;
                String::from_utf8_lossy(&b).into_owned()
            } else {
                String::new()
            };
            Ok(json!(value))
        }
        "job:run" | "tdl:run" => e.launch(p).await,
        "tdl:stop" => Ok(e.stop(&text(&p))),
        "comment-forward:start" => {
            let mut spec = p.clone();
            spec["kind"] = json!("comment-forward");
            e.launch(json!({"taskId":p["taskId"],"spec":spec})).await
        }
        "comment-forward:stop" => Ok(e.stop_comments()),
        "export:analyze" => {
            let path = PathBuf::from(text(&p));
            tokio::task::spawn_blocking(move || filter::analyze(&path))
                .await
                .map_err(|e| e.to_string())
        }
        "comment-forward:progress:read" => Ok(comments::progress_summary(Path::new(&text(&p)))),
        "chats:latest-message" => Ok(e
            .latest(&text(&p))
            .await
            .unwrap_or_else(|err| json!({"ok":false,"message":err}))),
        "chats:cache:get" => e.chat_cache("get", "").await,
        "chats:cache:ensure" => e.chat_cache("ensure", "").await,
        "chats:cache:refresh" => e.chat_cache("refresh", "").await,
        "chats:list" => match e.chat_cache("list", &text(&p["filter"])).await {
            Ok(v) => Ok(v["chats"].clone()),
            Err(err) => Ok(json!({"error":err})),
        },
        "environment:check" => {
            let c = e.config()?;
            let token = CancellationToken::new();
            let out = engine::timed(
                e.command(
                    "environment",
                    &["version".into()],
                    &json!({"tdlPath":c["tdlPath"]}),
                    None,
                    &token,
                    true,
                ),
                &token,
                8,
            )
            .await;
            let (ok, detail) = match out {
                Ok(o) if o.code == 0 => (
                    true,
                    if o.stdout.trim().is_empty() {
                        o.stderr.trim().to_owned()
                    } else {
                        o.stdout.trim().to_owned()
                    },
                ),
                Ok(o) => (false, o.error()),
                Err(err) => (false, err),
            };
            let dir = PathBuf::from(text(&c["defaultDownloadDir"]));
            let write = fs::create_dir_all(&dir)
                .map_err(|e| e.to_string())
                .and_then(|_| {
                    tempfile::NamedTempFile::new_in(&dir)
                        .map(|_| ())
                        .map_err(|e| e.to_string())
                });
            let proxy = text(&c["proxy"]);
            let ns = text(&c["ns"]);
            let checks = json!([{"key":"tdl","label":"tdl version","ok":ok,"detail":detail,"meta":engine::tdl_path(&c)},
                {"key":"output","label":"输出目录可写","ok":write.is_ok(),"detail":write.err().unwrap_or(dir.to_string_lossy().into())},
                {"key":"ns","label":"命名空间 ns","ok":!ns.trim().is_empty(),"detail":ns},
                {"key":"proxy","label":"代理","ok":proxy.is_empty()||["socks5://","http://","https://"].iter().any(|s|proxy.to_lowercase().starts_with(s)),"detail":proxy}]);
            Ok(
                json!({"ok":checks.as_array().unwrap().iter().all(|c|c["ok"]==true),"checkedAt":now(),"checks":checks}),
            )
        }
        "migration:export" => {
            let target = PathBuf::from(text(&p));
            write_json(
                &target,
                &json!({"format":"hopetdl-migration","version":1,"config":e.config()?,"runtime":e.store.snapshot(),"chatCache":read_json(&e.store.root.join("chats-cache.json")).unwrap_or(json!({"version":1,"caches":{}}))}),
            )?;
            Ok(json!({"ok":true,"filePath":target}))
        }
        "migration:import" => {
            if !e.store.snapshot()["tasks"]
                .as_array()
                .unwrap()
                .iter()
                .all(|t| !["queued", "running"].contains(&t["state"].as_str().unwrap_or("")))
            {
                return Err("请先停止运行和排队中的任务，再导入数据".into());
            }
            let data = read_json(Path::new(&text(&p)))?;
            if data["format"] != "hopetdl-migration" || data["version"] != 1 {
                return Err("不是受支持的 HopeTDL 迁移文件".into());
            }
            let mut incoming = if data["runtime"].is_object() {
                data["runtime"].clone()
            } else {
                let preferences = data["localStorage"]
                    .as_object()
                    .ok_or("迁移文件缺少偏好数据")?;
                let parse = |k: &str| -> Value {
                    preferences
                        .get(k)
                        .and_then(|v| v.as_str())
                        .and_then(|s| serde_json::from_str(s).ok())
                        .unwrap_or(json!([]))
                };
                json!({"tasks":parse("hopetdl.tasks.v1"),"schedules":parse("hopetdl.schedules.v1"),"preferences":preferences,"schedulerPaused":true})
            };
            if !incoming["tasks"].is_array()
                || !incoming["schedules"].is_array()
                || !incoming["preferences"].is_object()
            {
                return Err("迁移数据格式无效".into());
            }
            let backup = e
                .store
                .root
                .join(format!("before-import-{}.json", uuid::Uuid::new_v4()));
            write_json(
                &backup,
                &json!({"format":"hopetdl-migration","version":1,"config":e.config()?,"runtime":e.store.snapshot(),"chatCache":read_json(&e.store.root.join("chats-cache.json")).unwrap_or(Value::Null)}),
            )?;
            for task in incoming["tasks"].as_array_mut().unwrap() {
                if ["queued", "running", "运行中", "排队中"].contains(
                    &task["state"]
                        .as_str()
                        .or(task["status"].as_str())
                        .unwrap_or(""),
                ) {
                    task["state"] = json!("interrupted");
                    task["status"] = json!("已中断");
                }
            }
            // Import is paused so overdue plans cannot unexpectedly send messages.
            e.store.update(|d| {
                for k in ["tasks", "schedules", "preferences"] {
                    d[k] = incoming[k].clone();
                }
                d["schedulerPaused"] = json!(true);
                Ok(())
            })?;
            if data["config"].is_object() {
                write_json(&e.store.root.join("config.json"), &data["config"])?;
            }
            if data["chatCache"].is_object() {
                write_json(&e.store.root.join("chats-cache.json"), &data["chatCache"])?;
            }
            e.changed();
            Ok(
                json!({"ok":true,"backup":backup,"message":"导入完成，计划已暂停；重启应用后查看历史参数"}),
            )
        }
        "app:show" => {
            show(&app);
            Ok(json!(true))
        }
        "app:status" => Ok(json!(true)),
        "app:quit" => {
            quit(&app);
            Ok(json!(true))
        }
        _ => Err(format!("未知调用: {channel}")),
    }
}
fn show(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}
fn quit(app: &tauri::AppHandle) {
    let e = app.state::<Arc<Engine>>().inner().clone();
    if e.shutting_down.swap(true, Ordering::SeqCst) {
        return;
    }
    e.stop_all();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        for _ in 0..50 {
            if !e.has_processes()
                && e.store.snapshot()["tasks"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .all(|t| !["running", "queued"].contains(&t["state"].as_str().unwrap_or("")))
            {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
        app.exit(0);
    });
}
fn import_legacy_files(root: &Path) {
    if root.join("config.json").exists() {
        return;
    }
    #[cfg(target_os = "macos")]
    let base = std::env::var_os("HOME")
        .map(PathBuf::from)
        .map(|p| p.join("Library/Application Support"));
    #[cfg(target_os = "windows")]
    let base = std::env::var_os("APPDATA").map(PathBuf::from);
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|p| PathBuf::from(p).join(".config")));
    if let Some(base) = base {
        for name in ["tdl-gui-prototype", "HopeTDL", "com.hope.tdlgui"] {
            let old = base.join(name);
            if old.join("config.json").is_file() {
                for file in ["config.json", "chats-cache.json"] {
                    if old.join(file).is_file() && !root.join(file).exists() {
                        let _ = fs::copy(old.join(file), root.join(file));
                    }
                }
                break;
            }
        }
    }
}
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| show(app)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![request])
        .setup(|app| {
            let isolated = std::env::var_os("HOPETDL_DATA_DIR").map(PathBuf::from);
            let root = isolated.clone().unwrap_or(app.path().app_data_dir()?);
            fs::create_dir_all(&root)?;
            if isolated.is_none() {
                import_legacy_files(&root);
            }
            let output = app.path().document_dir()?.join("HopeTDL/output");
            let handle = app.handle().clone();
            let sink = Arc::new(move |channel: &str, payload: Value| {
                // Hidden windows do not receive progress floods. Logs remain on disk.
                if channel == "tdl:log"
                    && !handle
                        .get_webview_window("main")
                        .is_some_and(|w| w.is_visible().unwrap_or(false))
                {
                    return;
                }
                let _ = handle.emit(&channel.replace(':', "-"), payload);
            });
            let engine = Engine::new(root, output, sink).map_err(std::io::Error::other)?;
            app.manage(engine.clone());
            tauri::async_runtime::spawn(async move {
                scheduler::start(engine);
            });
            let open = MenuItem::with_id(app, "open", "打开 HopeTDL", true, None::<&str>)?;
            let tasks = MenuItem::with_id(app, "tasks", "任务", true, None::<&str>)?;
            let pause = MenuItem::with_id(app, "pause", "暂停 / 恢复定时任务", true, None::<&str>)?;
            let stop = MenuItem::with_id(app, "stop", "停止全部任务", true, None::<&str>)?;
            let output = MenuItem::with_id(app, "output", "打开输出目录", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出 HopeTDL", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &tasks, &pause, &stop, &output, &quit_item])?;
            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("HopeTDL · Rust 后台")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if matches!(event, TrayIconEvent::Click { .. }) {
                        show(tray.app_handle());
                    }
                })
                .on_menu_event(|app, event| {
                    let e = app.state::<Arc<Engine>>();
                    match event.id.as_ref() {
                        "open" => show(app),
                        "tasks" => {
                            show(app);
                            let _ = app.emit("app-navigate", "tasks");
                        }
                        "pause" => {
                            let paused = e.store.snapshot()["schedulerPaused"] != true;
                            if let Err(err) = e.store.update(|d| {
                                d["schedulerPaused"] = json!(paused);
                                Ok(())
                            }) {
                                e.emit("runtime:error", json!(err));
                            }
                            e.changed();
                        }
                        "stop" => {
                            e.stop_all();
                        }
                        "output" => {
                            let dir = e
                                .config()
                                .map(|c| text(&c["defaultDownloadDir"]))
                                .unwrap_or(e.output.to_string_lossy().into());
                            let _ = app.opener().open_path(dir, None::<&str>);
                        }
                        "quit" => quit(app),
                        _ => {}
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
            if let WindowEvent::Focused(true) = event {
                let e = window.state::<Arc<Engine>>();
                e.changed();
            }
        })
        .build(tauri::generate_context!())
        .expect("HopeTDL 启动失败");
    app.run(|app, event| {
        if let tauri::RunEvent::ExitRequested { ref api, .. } = event {
            if !app
                .state::<Arc<Engine>>()
                .shutting_down
                .load(Ordering::SeqCst)
            {
                api.prevent_exit();
                quit(app);
            }
        }
        if let tauri::RunEvent::Exit = event {
            app.state::<Arc<Engine>>().stop_all();
        }
    });
}
