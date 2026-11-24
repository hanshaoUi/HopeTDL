use crate::{text, Result};
use serde_json::{json, Value};
fn val(a: &mut Vec<String>, flag: &str, v: &Value) {
    let s = text(v);
    if !s.is_empty() {
        a.extend([flag.into(), s]);
    }
}
fn flag(a: &mut Vec<String>, f: &str, enabled: bool) {
    if enabled {
        a.push(f.into());
    }
}
pub fn global_args(c: &Value) -> Vec<String> {
    let mut a = vec![];
    for (key, f) in [
        ("proxy", "--proxy"),
        ("delay", "--delay"),
        ("limit", "-l"),
        ("threads", "--threads"),
        ("ns", "-n"),
    ] {
        if c[key] != 0 && c[key] != false {
            val(&mut a, f, &c[key]);
        }
    }
    a
}
pub fn to_args(s: &Value) -> Result<Vec<String>> {
    let kind = s["kind"].as_str().ok_or("JobSpec 缺少 kind")?;
    let mut a: Vec<String> = match kind {
        "login" => vec!["login"],
        "chat-list" => vec!["chat", "ls"],
        "export" => vec!["chat", "export"],
        "forward" => vec!["forward"],
        "upload" => vec!["upload"],
        "download" => vec!["download"],
        _ => return Err(format!("不支持的任务类型: {kind}")),
    }
    .into_iter()
    .map(str::to_owned)
    .collect();
    match kind {
        "login" => val(&mut a, "-T", &s["type"]),
        "chat-list" => {
            val(
                &mut a,
                "-o",
                &json!(s["output"]
                    .as_str()
                    .filter(|x| !x.is_empty())
                    .unwrap_or("json")),
            );
            val(&mut a, "--filter", &s["filter"]);
        }
        "export" => {
            val(&mut a, "-c", &s["chat"]);
            if !text(&s["reply"]).is_empty() {
                val(&mut a, "--reply", &s["reply"]);
            } else if s["selector"].is_object() && s["selector"]["type"] != "all" {
                val(&mut a, "-T", &s["selector"]["type"]);
                val(&mut a, "-i", &s["selector"]["input"]);
            }
            for (k, f) in [
                ("all", "--all"),
                ("raw", "--raw"),
                ("withContent", "--with-content"),
            ] {
                flag(&mut a, f, s[k] == true);
            }
            val(&mut a, "-o", &s["output"]);
        }
        "forward" => {
            val(&mut a, "--from", &s["from"]);
            let t = &s["target"];
            let target = if !text(&t["routerFile"]).is_empty() {
                text(&t["routerFile"])
            } else if !text(&t["thread"]).is_empty() && !text(&t["peer"]).is_empty() {
                let thread = text(&t["thread"])
                    .parse::<u64>()
                    .map_err(|_| "话题 ID 必须是非负整数")?;
                format!(
                    "{{ Peer: {}, Thread: {} }}",
                    json!(text(&t["peer"])),
                    thread
                )
            } else {
                text(&t["peer"])
            };
            val(&mut a, "--to", &json!(target));
            val(&mut a, "--mode", &s["mode"]);
            for (k, f) in [
                ("dryRun", "--dry-run"),
                ("silent", "--silent"),
                ("single", "--single"),
                ("desc", "--desc"),
            ] {
                flag(&mut a, f, s[k] == true);
            }
            val(&mut a, "--edit", &s["edit"]);
        }
        "upload" => {
            for (k, f) in [
                ("path", "-p"),
                ("chat", "-c"),
                ("topic", "--topic"),
                ("caption", "--caption"),
            ] {
                val(&mut a, f, &s[k]);
            }
            flag(&mut a, "--photo", s["photo"] == true);
            flag(&mut a, "--rm", s["remove"] == true);
        }
        "download" => {
            for (k, f) in [
                ("directory", "-d"),
                ("include", "-i"),
                ("exclude", "-e"),
                ("template", "--template"),
            ] {
                val(&mut a, f, &s[k]);
            }
            for (k, f) in [
                ("group", "--group"),
                ("skipSame", "--skip-same"),
                ("rewriteExt", "--rewrite-ext"),
                ("serve", "--serve"),
            ] {
                flag(&mut a, f, s[k] == true);
            }
            if s["serve"] == true {
                val(&mut a, "--port", &s["port"]);
            }
            flag(&mut a, "--takeout", s["takeout"] == true);
            flag(&mut a, "--desc", s["desc"] == true);
            flag(&mut a, "--continue", s["resumeMode"] == "continue");
            flag(&mut a, "--restart", s["resumeMode"] == "restart");
            if let Some(items) = s["source"]["items"].as_array() {
                for item in items {
                    val(
                        &mut a,
                        if s["source"]["type"] == "url" {
                            "-u"
                        } else {
                            "-f"
                        },
                        item,
                    );
                }
            }
        }
        _ => unreachable!(),
    }
    Ok(a)
}
pub fn replace_arg(args: &mut Vec<String>, names: &[&str], value: String) {
    if let Some(i) = args.iter().position(|a| names.contains(&a.as_str())) {
        if i + 1 < args.len() {
            args[i + 1] = value;
        } else {
            args.push(value);
        }
    } else {
        args.extend([names[0].into(), value]);
    }
}
pub fn arg(args: &[String], names: &[&str]) -> String {
    args.iter()
        .position(|a| names.contains(&a.as_str()))
        .and_then(|i| args.get(i + 1))
        .cloned()
        .unwrap_or_default()
}
