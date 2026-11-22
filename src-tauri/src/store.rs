use crate::{now, Result};
use serde_json::{json, Value};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};

pub fn read_json(path: &Path) -> Result<Value> {
    serde_json::from_slice(&fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?)
        .map_err(|e| format!("{}: {e}", path.display()))
}

// Write beside the destination, flush, then atomically replace it. A failed write
// keeps the previous file; malformed existing stores are never silently reset.
pub fn write_json(path: &Path, value: &Value) -> Result<()> {
    let parent = path.parent().ok_or("文件路径缺少父目录")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    serde_json::to_writer(&mut temp, value).map_err(|e| e.to_string())?;
    temp.flush().map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    temp.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}

pub struct Store {
    pub root: PathBuf,
    data: Mutex<Value>,
}
impl Store {
    pub fn open(root: PathBuf) -> Result<Self> {
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        let path = root.join("runtime.json");
        let mut data = if path.exists() {
            read_json(&path)?
        } else {
            json!({"schemaVersion":1,"revision":0,"tasks":[],"schedules":[],"preferences":{},"schedulerPaused":false})
        };
        if data["schemaVersion"] != 1
            || !data["tasks"].is_array()
            || !data["schedules"].is_array()
            || !data["preferences"].is_object()
        {
            return Err("runtime.json 格式或版本不受支持，请先备份并检查数据".into());
        }
        for task in data["tasks"].as_array_mut().unwrap() {
            if ["running", "queued", "运行中", "排队中"].contains(
                &task["state"]
                    .as_str()
                    .or(task["status"].as_str())
                    .unwrap_or(""),
            ) {
                task["previousState"] = task["state"].clone();
                task["state"] = json!("interrupted");
                task["status"] = json!("已中断");
                task["finishedAt"] = json!(now());
                task["recoveryReason"] =
                    json!("应用上次退出时任务尚未结束；未自动重放，避免重复转发");
            }
        }
        write_json(&path, &data)?;
        Ok(Self {
            root,
            data: Mutex::new(data),
        })
    }
    pub fn snapshot(&self) -> Value {
        self.data.lock().unwrap().clone()
    }
    pub fn update<T>(&self, f: impl FnOnce(&mut Value) -> Result<T>) -> Result<T> {
        let mut guard = self.data.lock().unwrap();
        let mut next = guard.clone();
        let result = f(&mut next)?;
        next["revision"] = json!(guard["revision"].as_u64().unwrap_or(0) + 1);
        write_json(&self.root.join("runtime.json"), &next)?;
        *guard = next;
        Ok(result)
    }
    pub fn task(&self, id: &str, patch: Value) -> Result<()> {
        self.update(|data| {
            let tasks = data["tasks"].as_array_mut().unwrap();
            if let Some(task) = tasks.iter_mut().find(|t| t["id"] == id) {
                for (k, v) in patch.as_object().ok_or("任务补丁必须是对象")? {
                    task[k] = v.clone();
                }
            } else {
                return Err(format!("任务不存在: {id}"));
            }
            Ok(())
        })
    }
    pub fn config(&self, output: &Path) -> Result<Value> {
        let mut c = json!({"ns":"hope","proxy":"","delay":"","limit":1,"threads":4,"maxConcurrentTasks":2,"chatCacheDays":7,
            "defaultDownloadDir":output,"tdlPath":"tdl","forwardFilterEnabled":false,"filterKeywordsText":"",
            "filterKeywordAction":"drop-message","filterKeywordReplacement":"","removeLinks":false,"blockImages":false,
            "blockVideos":false,"blockTextOnly":false,"keywordCaseSensitive":false,"keywordRegexMode":false});
        let file = self.root.join("config.json");
        if file.exists() {
            let saved = read_json(&file)?;
            for (k, v) in saved.as_object().ok_or("config.json 必须是对象")? {
                c[k] = v.clone();
            }
        }
        Ok(c)
    }
}
