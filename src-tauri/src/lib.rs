pub mod comments;
#[cfg(feature = "desktop")]
pub mod desktop;
pub mod engine;
pub mod filter;
pub mod jobs;
pub mod scheduler;
pub mod store;

pub type Result<T> = std::result::Result<T, String>;
pub fn text(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::Null => String::new(),
        serde_json::Value::String(s) => s.clone(),
        _ => v.to_string(),
    }
}
pub fn now() -> String {
    chrono::Local::now().to_rfc3339()
}
pub fn millis() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
