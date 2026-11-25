use crate::{
    store::{read_json, write_json},
    text, Result,
};
use regress::Regex;
use serde_json::{json, Value};
use std::{collections::BTreeSet, path::Path};

const MESSAGE_KEYS: &[&str] = &[
    "date",
    "message",
    "text",
    "raw",
    "media",
    "file",
    "from_id",
    "fromId",
    "peer_id",
    "peerId",
    "reply_to",
    "replyTo",
    "edit_date",
    "editDate",
    "entities",
    "views",
    "forwards",
    "out",
    "post",
    "grouped_id",
    "groupedId",
    "via_bot_id",
    "viaBotId",
    "ttl_period",
    "ttlPeriod",
    "caption",
    "content",
];
const TEXT_KEYS: &[&str] = &[
    "message",
    "text",
    "caption",
    "content",
    "raw_text",
    "rawText",
    "body",
    "title",
    "description",
];
fn trusted(key: &str) -> bool {
    ["messages", "message", "items", "list", "data", "result"]
        .contains(&key.to_lowercase().as_str())
}
pub fn message_id(v: &Value) -> Option<u64> {
    ["id", "ID", "message_id", "messageID"]
        .iter()
        .find_map(|k| (!v[*k].is_null()).then_some(&v[*k]))
        .and_then(|id| {
            let s = text(id);
            if s.is_empty() {
                None
            } else {
                s.parse::<u64>()
                    .ok()
                    .filter(|i| *i <= 9_007_199_254_740_991)
            }
        })
}
fn is_message(v: &Value, trust: bool) -> bool {
    v.is_object()
        && message_id(v).is_some()
        && (trust || MESSAGE_KEYS.iter().any(|k| v.get(*k).is_some()))
}
pub fn message_ids(v: &Value) -> Vec<u64> {
    fn visit(v: &Value, key: &str, ids: &mut BTreeSet<u64>) {
        match v {
            Value::Array(a) => {
                for x in a {
                    if is_message(x, trusted(key)) {
                        ids.insert(message_id(x).unwrap());
                    }
                    visit(x, key, ids);
                }
            }
            Value::Object(m) => {
                for (k, x) in m {
                    visit(x, k, ids);
                }
            }
            _ => {}
        }
    }
    let mut ids = BTreeSet::new();
    visit(v, "", &mut ids);
    ids.into_iter().collect()
}
pub fn analyze(path: &Path) -> Value {
    let r = (|| -> Result<Value> {
        let ids = message_ids(&read_json(path)?);
        let min = ids.first().ok_or("没有在导出 JSON 中识别到消息 ID")?;
        let max = ids.last().unwrap();
        Ok(
            json!({"ok":true,"filePath":path,"count":ids.len(),"minId":min,"maxId":max,"nextStartId":max+1,"nextInput":format!("{},9223372036854775807",max+1)}),
        )
    })();
    r.unwrap_or_else(|e| json!({"ok":false,"reason":e,"filePath":path}))
}
fn keywords(v: &Value) -> Vec<String> {
    if let Some(a) = v.as_array() {
        return a
            .iter()
            .map(text)
            .map(|s| s.trim().to_owned())
            .filter(|s| !s.is_empty())
            .collect();
    }
    text(v)
        .split(['\n', ',', '，'])
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .collect()
}
fn nested_text(key: &str) -> bool {
    let k = key.to_lowercase();
    ["message", "text", "caption", "content", "raw"]
        .iter()
        .any(|x| k.contains(x))
}
fn collect_text(v: &Value, depth: usize, out: &mut Vec<String>) {
    if depth > 5 {
        return;
    }
    if let Some(a) = v.as_array() {
        for x in a {
            collect_text(x, depth + 1, out);
        }
    } else if let Some(m) = v.as_object() {
        for (k, x) in m {
            if TEXT_KEYS.contains(&k.as_str()) && x.is_string() {
                out.push(text(x));
            } else if nested_text(k) && (x.is_object() || x.is_array()) {
                collect_text(x, depth + 1, out);
            }
        }
    }
}
pub fn media_kind(v: &Value) -> &'static str {
    fn visit(v: &Value, depth: usize, out: &mut Vec<String>) {
        if depth > 4 {
            return;
        }
        let entries: Vec<(String, &Value)> = if let Some(m) = v.as_object() {
            m.iter().map(|(k, v)| (k.clone(), v)).collect()
        } else if let Some(a) = v.as_array() {
            a.iter()
                .enumerate()
                .map(|(i, v)| (i.to_string(), v))
                .collect()
        } else {
            vec![]
        };
        for (k, x) in entries {
            let k = k.to_lowercase();
            if x.is_string()
                && ["file", "path", "name", "mime", "type", "media"]
                    .iter()
                    .any(|a| k.contains(a))
            {
                let value = text(x);
                let media_field = [
                    "file", "path", "mime", "media", "document", "photo", "video",
                ]
                .iter()
                .any(|a| k.contains(a));
                let metadata_type = k == "type"
                    && ["message", "service", "message_service"]
                        .contains(&value.to_lowercase().as_str());
                if !value.trim().is_empty()
                    && !metadata_type
                    && (depth > 0
                        || media_field
                        || k == "type"
                            && [
                                "photo",
                                "video",
                                "image",
                                "document",
                                "audio",
                                "sticker",
                                "animation",
                            ]
                            .contains(&value.to_lowercase().as_str()))
                {
                    out.push(value);
                }
            } else if (x.is_object() || x.is_array())
                && ["file", "media", "document", "photo", "video", "content"]
                    .iter()
                    .any(|a| k.contains(a))
            {
                visit(x, depth + 1, out);
            }
        }
    }
    let mut c = vec![];
    visit(v, 0, &mut c);
    let joined = c.join(" ").to_lowercase();
    let words: Vec<_> = joined.split(|c: char| !c.is_ascii_lowercase()).collect();
    if joined.contains("image/") || words.contains(&"photo") || words.contains(&"image") {
        return "image";
    }
    if joined.contains("video/") || words.contains(&"video") {
        return "video";
    }
    for s in &c {
        let base = s.split(['?', '#']).next().unwrap_or("");
        let ext = Path::new(base)
            .extension()
            .and_then(|x| x.to_str())
            .unwrap_or("")
            .to_lowercase();
        if [
            "jpg", "jpeg", "png", "gif", "webp", "bmp", "heic", "heif", "avif", "tif", "tiff",
        ]
        .contains(&ext.as_str())
        {
            return "image";
        }
        if [
            "mp4", "mkv", "mov", "avi", "webm", "m4v", "flv", "wmv", "mpeg", "mpg", "ts",
        ]
        .contains(&ext.as_str())
        {
            return "video";
        }
    }
    if c.is_empty() {
        "text"
    } else {
        "other"
    }
}

pub struct Filter {
    c: Value,
    rules: Vec<(String, Regex)>,
    pub enabled: bool,
    global: bool,
    links: Regex,
}
impl Filter {
    pub fn new(c: &Value) -> Result<Self> {
        let global = c["forwardFilterEnabled"] != false;
        let mut raw = if global {
            keywords(&c["filterKeywordsText"])
        } else {
            vec![]
        };
        raw.extend(keywords(if c["blockKeywordsText"].is_null() {
            &c["blockKeywords"]
        } else {
            &c["blockKeywordsText"]
        }));
        let mut seen = BTreeSet::new();
        raw.retain(|s| seen.insert(s.clone()));
        let flags = if c["keywordCaseSensitive"] == true {
            "m"
        } else {
            "im"
        };
        let mut rules = vec![];
        for s in raw {
            let source = if c["keywordRegexMode"] == true {
                s.clone()
            } else {
                regex::escape(&s)
            };
            let re = Regex::with_flags(&source, flags)
                .map_err(|e| format!("无效关键词正则 {s}: {e}"))?;
            rules.push((s, re));
        }
        let enabled = !rules.is_empty()
            || global
                && ["removeLinks", "blockImages", "blockVideos", "blockTextOnly"]
                    .iter()
                    .any(|k| c[*k] == true);
        Ok(Self {
            c: c.clone(),
            rules,
            enabled,
            global,
            links: Regex::with_flags(
                r"(?:https?://|tg://|www\.|(?:^|\s)t\.me/)[^\s<>()\[\]{}]+",
                "iu",
            )
            .map_err(|e| e.to_string())?,
        })
    }
    fn action(&self) -> &str {
        if !self.global {
            "drop-message"
        } else {
            self.c["filterKeywordAction"]
                .as_str()
                .unwrap_or("drop-message")
        }
    }
    fn hit(&self, s: &str) -> Option<&str> {
        self.rules
            .iter()
            .find(|(_, re)| re.find(s).is_some())
            .map(|(s, _)| s.as_str())
    }
    fn clean(&self, s: &str, stats: &mut Value) -> String {
        let mut s = s.to_owned();
        if self.action() == "remove-segment" {
            s = s
                .lines()
                .filter(|s| self.hit(s).is_none())
                .collect::<Vec<_>>()
                .join("\n");
        } else if self.action() == "replace" {
            for (_, re) in &self.rules {
                s = js_replace(re, &s, &text(&self.c["filterKeywordReplacement"]));
            }
        }
        if self.global && self.c["removeLinks"] == true {
            let next = self.links.replace_all_with(&s, |_| String::new());
            if next != s {
                stats["linksRemoved"] = json!(stats["linksRemoved"].as_u64().unwrap() + 1);
            }
            s = next;
        }
        s.lines()
            .map(str::trim_end)
            .filter(|s| !s.trim().is_empty())
            .collect::<Vec<_>>()
            .join("\n")
            .trim()
            .to_owned()
    }
    fn rewrite(&self, v: &mut Value, depth: usize, stats: &mut Value) {
        if depth > 5 {
            return;
        }
        if let Some(a) = v.as_array_mut() {
            for x in a {
                self.rewrite(x, depth + 1, stats);
            }
        } else if let Some(m) = v.as_object_mut() {
            for (k, x) in m {
                if TEXT_KEYS.contains(&k.as_str()) && x.is_string() {
                    *x = json!(self.clean(x.as_str().unwrap(), stats));
                } else if nested_text(k) && (x.is_object() || x.is_array()) {
                    self.rewrite(x, depth + 1, stats);
                }
            }
        }
    }
    pub fn apply(&self, mut v: Value) -> Value {
        let mut stats = json!({"enabled":self.enabled,"removed":0,"removedByType":{"image":0,"video":0,"text":0},"linksRemoved":0,"hitKeywords":[],"count":0,"hasKeywordRules":!self.rules.is_empty(),"filterError":false});
        let mut hits = vec![];
        let mut ids = BTreeSet::new();
        self.visit(&mut v, "", &mut stats, &mut hits, &mut ids);
        stats["json"] = v;
        stats["hitKeywords"] = json!(hits);
        stats["count"] = json!(ids.len());
        stats
    }
    fn visit(
        &self,
        v: &mut Value,
        key: &str,
        stats: &mut Value,
        hits: &mut Vec<String>,
        ids: &mut BTreeSet<u64>,
    ) {
        if let Some(a) = v.as_array_mut() {
            a.retain_mut(|item| {
                if is_message(item, trusted(key)) {
                    let kind = media_kind(item);
                    let block = self.global
                        && match kind {
                            "image" => self.c["blockImages"] == true,
                            "video" => self.c["blockVideos"] == true,
                            "text" => self.c["blockTextOnly"] == true,
                            _ => false,
                        };
                    let mut texts = vec![];
                    collect_text(item, 0, &mut texts);
                    let hit = self.hit(&texts.join("\n")).map(str::to_owned);
                    if block || hit.is_some() && self.action() == "drop-message" {
                        stats["removed"] = json!(stats["removed"].as_u64().unwrap() + 1);
                        if block {
                            stats["removedByType"][kind] =
                                json!(stats["removedByType"][kind].as_u64().unwrap() + 1);
                        } else if let Some(h) = hit {
                            if !hits.contains(&h) {
                                hits.push(h);
                            }
                        }
                        return false;
                    }
                    if let Some(h) = hit {
                        if !hits.contains(&h) {
                            hits.push(h);
                        }
                    }
                    if self.enabled {
                        self.rewrite(item, 0, stats);
                    }
                    ids.insert(message_id(item).unwrap());
                }
                self.visit(item, key, stats, hits, ids);
                true
            });
        } else if let Some(m) = v.as_object_mut() {
            for (k, x) in m {
                self.visit(x, k, stats, hits, ids);
            }
        }
    }
    pub fn file(&self, source: &Path, target: &Path) -> Result<Value> {
        // Fail closed on malformed exports: never forward an unexamined file.
        let mut result = self.apply(read_json(source)?);
        let content = result.as_object_mut().unwrap().remove("json").unwrap();
        if self.enabled {
            write_json(target, &content)?;
        }
        result["file"] = json!(if self.enabled { target } else { source });
        Ok(result)
    }
}

// ECMAScript replacement tokens differ from Rust's usual $0/${name} syntax.
fn js_replace(re: &Regex, s: &str, replacement: &str) -> String {
    re.replace_all_with(s, |m| {
        let mut out = String::new();
        let mut it = replacement.chars().peekable();
        while let Some(c) = it.next() {
            if c != '$' {
                out.push(c);
                continue;
            }
            match it.peek().copied() {
                Some('$') => {
                    it.next();
                    out.push('$');
                }
                Some('&') => {
                    it.next();
                    out.push_str(&s[m.range()]);
                }
                Some('`') => {
                    it.next();
                    out.push_str(&s[..m.start()]);
                }
                Some('\'') => {
                    it.next();
                    out.push_str(&s[m.end()..]);
                }
                Some('<') if m.named_groups().next().is_some() => {
                    let mut probe = it.clone();
                    probe.next();
                    let mut name = String::new();
                    let mut closed = false;
                    for c in probe.by_ref() {
                        if c == '>' {
                            closed = true;
                            break;
                        }
                        name.push(c);
                    }
                    if closed {
                        it = probe;
                        if let Some(r) = m.named_group(&name) {
                            out.push_str(&s[r]);
                        }
                    } else {
                        out.push('$');
                    }
                }
                Some(d) if d.is_ascii_digit() => {
                    let first = d.to_digit(10).unwrap() as usize;
                    it.next();
                    let mut n = first;
                    if let Some(d2) = it.peek().and_then(|c| c.to_digit(10)) {
                        let two = n * 10 + d2 as usize;
                        if two > 0 && two <= m.captures.len() {
                            n = two;
                            it.next();
                        }
                    }
                    if n > 0 && n <= m.captures.len() {
                        if let Some(r) = m.captures[n - 1].clone() {
                            out.push_str(&s[r]);
                        }
                    } else {
                        out.push('$');
                        out.push(d);
                    }
                }
                _ => out.push('$'),
            }
        }
        out
    })
}
