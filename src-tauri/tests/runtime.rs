use hopetdl_lib::{
    engine::Engine,
    filter::{message_ids, Filter},
    jobs, scheduler,
    store::{read_json, write_json, Store},
};
use serde_json::{json, Value};
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

#[test]
fn filtering_preserves_metadata_and_applies_types_lines_and_local_rules() {
    let input = json!({"id":999,"messages":[{"id":1,"text":"正常\n推广\n正文 https://t.me/demo","date":1},{"id":2,"file":"photo.JPG"},{"id":3,"file":"movie.mp4"}]});
    let result=Filter::new(&json!({"filterKeywordsText":"推广","filterKeywordAction":"remove-segment","removeLinks":true,"blockImages":true,"blockVideos":true})).unwrap().apply(input);
    assert_eq!(result["json"]["id"], 999);
    assert_eq!(result["count"], 1);
    assert_eq!(result["removed"], 2);
    assert_eq!(result["json"]["messages"][0]["text"], "正常\n正文");
    let local=Filter::new(&json!({"forwardFilterEnabled":false,"blockKeywordsText":"广告","filterKeywordAction":"replace"})).unwrap().apply(json!({"messages":[{"id":1,"text":"广告"}]}));
    assert_eq!(local["count"], 0);
}
#[test]
fn regex_replacement_and_nested_ids_match_existing_semantics() {
    let result=Filter::new(&json!({"filterKeywordsText":"(?<=编号)([0-9]+)","keywordRegexMode":true,"filterKeywordAction":"replace","filterKeywordReplacement":"[$1:$&:$$]"})).unwrap().apply(json!({"messages":[{"id":"12","text":"编号123"}]}));
    assert_eq!(result["json"]["messages"][0]["text"], "编号[123:123:$]");
    assert_eq!(
        message_ids(
            &json!({"id":999,"messages":[{"id":1},{"ID":"2"},{"id":9007199254740992u64},{"id":-1}]})
        ),
        vec![1, 2]
    );
}
#[test]
fn corrupt_exports_fail_closed_and_original_file_is_preserved() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("input.json");
    std::fs::write(&source, "invalid").unwrap();
    assert!(Filter::new(&json!({}))
        .unwrap()
        .file(&source, &dir.path().join("filtered.json"))
        .is_err());
    assert_eq!(std::fs::read_to_string(source).unwrap(), "invalid");
}
#[test]
fn store_recovers_tasks_without_replaying_and_rejects_corruption() {
    let dir = tempfile::tempdir().unwrap();
    let s = Store::open(dir.path().into()).unwrap();
    s.update(|d| {
        d["tasks"] = json!([{"id":"a","state":"running"},{"id":"b","state":"success"}]);
        Ok(())
    })
    .unwrap();
    drop(s);
    let s = Store::open(dir.path().into()).unwrap();
    assert_eq!(s.snapshot()["tasks"][0]["state"], "interrupted");
    assert_eq!(s.snapshot()["tasks"][1]["state"], "success");
    drop(s);
    std::fs::write(dir.path().join("runtime.json"), "broken").unwrap();
    assert!(Store::open(dir.path().into()).is_err());
    assert_eq!(
        std::fs::read_to_string(dir.path().join("runtime.json")).unwrap(),
        "broken"
    );
}
#[test]
fn jobs_preserve_argv_boundaries_and_large_range_strings() {
    assert_eq!(jobs::to_args(&json!({"kind":"export","chat":"@demo","selector":{"type":"id","input":"1,9223372036854775807"},"all":true,"withContent":true,"output":"/tmp/path with spaces/a.json"})).unwrap(),vec!["chat","export","-c","@demo","-T","id","-i","1,9223372036854775807","--all","--with-content","-o","/tmp/path with spaces/a.json"]);
    assert_eq!(
        jobs::to_args(&json!({"kind":"export","selector":{"type":"all"}})).unwrap(),
        vec!["chat", "export"]
    );
    assert!(jobs::to_args(&json!({"kind":"unknown"})).is_err());
}
#[test]
fn all_jobs_match_the_existing_javascript_compiler() {
    use std::io::Write;
    let fixtures: Vec<Value> =
        serde_json::from_str(include_str!("../../test/fixtures/jobs.json")).unwrap();
    let mut child=std::process::Command::new("node").args(["--input-type=module","-e",r#"import {toArgs} from './shared/jobSpec.mjs';let data='';for await(const chunk of process.stdin)data+=chunk;console.log(JSON.stringify(JSON.parse(data).map(toArgs)))"#])
        .current_dir(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap()).stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).spawn().unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(serde_json::to_string(&fixtures).unwrap().as_bytes())
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success());
    let expected: Vec<Vec<String>> = serde_json::from_slice(&output.stdout).unwrap();
    for (spec, want) in fixtures.iter().zip(expected) {
        assert_eq!(jobs::to_args(spec).unwrap(), want, "spec={spec}");
    }
}

#[test]
fn comment_work_directory_resolves_relative_paths_before_spawning() {
    use hopetdl_lib::comments::work_dir;
    let cwd = std::env::current_dir().unwrap();
    assert_eq!(
        work_dir(&json!({"workDir":"parity output"}), &cwd),
        cwd.join("parity output")
    );
    assert!(work_dir(&json!({"baseOutputDir":"relative output"}), &cwd)
        .starts_with(cwd.join("relative output/comment-forward")));
    let temp = tempfile::tempdir().unwrap();
    let absolute = temp.path().join("absolute output");
    assert!(absolute.is_absolute());
    assert_eq!(work_dir(&json!({"workDir":absolute}), &cwd), absolute);
}

#[cfg(unix)]
mod process_tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    type Events = Arc<Mutex<Vec<(String, Value)>>>;
    fn fixture() -> (tempfile::TempDir, Arc<Engine>, Events) {
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("fake tdl.py");
        std::fs::write(&bin,r##"#!/usr/bin/env python3
import sys,json,time,pathlib,os
a=sys.argv[1:]
root=pathlib.Path(__file__).parent
with open(root/'calls.jsonl','a') as f:f.write(json.dumps(a)+'\n')
def arg(k,default=''):
    return a[a.index(k)+1] if k in a else default
chat=arg('-c')
if chat=='slow':time.sleep(1.2)
if chat=='failure':
    print('403 forbidden',file=sys.stderr);sys.exit(2)
if 'version' in a: print('fake tdl v1');sys.exit(0)
if 'ls' in a:print(json.dumps([{'id':1,'title':'测试对话'}]));sys.exit(0)
if 'export' in a:
    output=pathlib.Path(arg('-o'));output.parent.mkdir(parents=True,exist_ok=True)
    ids=[12] if arg('-T')=='last' else [1,2]
    if arg('-T')=='id' and arg('-i').split(',')[0]==arg('-i').split(',')[-1]:ids=[int(arg('-i').split(',')[0])]
    if '--reply' in a: ids=[] if arg('--reply')=='1' else [21]
    output.write_text(json.dumps({'id':999,'messages':[{'id':i,'date':1,'text':'广告' if i==2 else 'message'} for i in ids]}))
if 'forward' in a and (root/'fail-topic').exists() and arg('--to').endswith('target_router.txt'):
    print('MSG_ID_INVALID',file=sys.stderr);sys.exit(2)
if 'forward' in a and (root/'fail-post').exists() and 'post_1' in arg('--from'):
    print('forward failure',file=sys.stderr);sys.exit(2)
if 'wait-demo' in a:
    sys.stdout.write('FLOOD_');sys.stdout.flush();time.sleep(.15);sys.stdout.write('WAIT_2\n');sys.stdout.flush()
if 'flood' in a:
    for i in range(4000):sys.stdout.buffer.write(('进度%d\r'%i).encode())
    sys.stdout.buffer.flush()
print('任务完成')
"##).unwrap();
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        write_json(
            &dir.path().join("config.json"),
            &json!({"tdlPath":bin,"maxConcurrentTasks":1}),
        )
        .unwrap();
        let events: Events = Arc::new(Mutex::new(vec![]));
        let out = events.clone();
        let e = Engine::new(
            dir.path().into(),
            dir.path().join("output"),
            Arc::new(move |channel, payload| out.lock().unwrap().push((channel.into(), payload))),
        )
        .unwrap();
        (dir, e, events)
    }
    async fn done(e: &Engine, id: &str) -> Value {
        tokio::time::timeout(Duration::from_secs(8), async {
            loop {
                let d = e.store.snapshot();
                let t = d["tasks"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|t| t["id"] == id)
                    .cloned()
                    .unwrap();
                if !["running", "queued"].contains(&t["state"].as_str().unwrap()) {
                    return t;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .unwrap()
    }
    #[tokio::test]
    async fn queue_and_cancellation_do_not_spawn_cancelled_queued_work() {
        let (dir, e, _) = fixture();
        e.launch(json!({"taskId":"slow","args":["chat","export","-c","slow","-o",dir.path().join("slow.json")]})).await.unwrap();
        tokio::time::sleep(Duration::from_millis(80)).await;
        e.launch(json!({"taskId":"waiting","args":["version"]}))
            .await
            .unwrap();
        assert_eq!(e.store.snapshot()["tasks"][0]["state"], "queued");
        e.stop("waiting");
        assert_eq!(done(&e, "waiting").await["state"], "stopped");
        e.stop("slow");
        assert_eq!(done(&e, "slow").await["state"], "stopped");
        let calls = std::fs::read_to_string(dir.path().join("calls.jsonl")).unwrap_or_default();
        assert!(!calls.contains("version"));
    }
    #[tokio::test]
    async fn concurrency_changes_wake_queue_and_lowering_keeps_running_leases() {
        let (dir, e, _) = fixture();
        async fn wait_state(e: &Engine, id: &str, state: &str) {
            tokio::time::timeout(Duration::from_secs(3), async {
                loop {
                    if e.store.snapshot()["tasks"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .any(|t| t["id"] == id && t["state"] == state)
                    {
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(5)).await;
                }
            })
            .await
            .unwrap();
        }
        for id in ["first", "second"] {
            e.launch(json!({"taskId":id,"args":["chat","export","-c","slow","-o",dir.path().join(format!("{id}.json"))]})).await.unwrap();
        }
        wait_state(&e, "first", "running").await;
        assert_eq!(e.snapshot()["activeSlots"], 1);
        assert_eq!(e.store.snapshot()["tasks"][0]["state"], "queued");
        let mut config = e.config().unwrap();
        config["maxConcurrentTasks"] = json!(2);
        e.set_config(&config).unwrap();
        wait_state(&e, "second", "running").await;
        assert_eq!(e.snapshot()["activeSlots"], 2);
        config["maxConcurrentTasks"] = json!(1);
        e.set_config(&config).unwrap();
        e.launch(json!({"taskId":"third","args":["version"]}))
            .await
            .unwrap();
        e.stop("first");
        done(&e, "first").await;
        tokio::time::sleep(Duration::from_millis(40)).await;
        assert_eq!(e.store.snapshot()["tasks"][0]["state"], "queued");
        assert_eq!(e.snapshot()["availableSlots"], 0);
        e.stop("second");
        done(&e, "second").await;
        assert_eq!(done(&e, "third").await["state"], "success");
        assert_eq!(e.snapshot()["activeSlots"], 0);
    }
    #[tokio::test]
    async fn preview_uses_launch_filters_without_starting_a_process_or_writing_files() {
        let (dir, e, _) = fixture();
        let mut config = e.config().unwrap();
        config["forwardFilterEnabled"] = json!(false);
        e.set_config(&config).unwrap();
        let result=e.preview_filter(&json!({"json":{"messages":[{"id":1,"text":"广告"},{"id":2,"text":"正常"}]},"spec":{"kind":"comment-forward","blockKeywordsText":"广告"}})).unwrap();
        assert_eq!(result["removed"], 1);
        assert_eq!(result["count"], 1);
        assert_eq!(result["json"]["messages"][0]["id"], 2);
        assert!(!dir.path().join("calls.jsonl").exists());
        assert!(e
            .preview_filter(&json!({"json":"x".repeat(256*1024)}))
            .is_err());
        assert_eq!(e.version().await.unwrap()["ok"], true);
        let calls = std::fs::read_to_string(dir.path().join("calls.jsonl")).unwrap();
        assert_eq!(calls.lines().count(), 1);
        assert!(calls.contains("version"));
        assert!(!calls.contains("ls"));
    }
    #[tokio::test]
    async fn flood_wait_survives_split_output_without_replaying_commands() {
        let (dir, e, events) = fixture();
        e.launch(json!({"taskId":"limited","args":["wait-demo"]}))
            .await
            .unwrap();
        let task = done(&e, "limited").await;
        assert!(task["floodWaitUntil"].as_i64().unwrap() > 0);
        assert!(events
            .lock()
            .unwrap()
            .iter()
            .any(|(n, p)| n == "task:flood-wait" && p["seconds"] == 2));
        assert_eq!(
            std::fs::read_to_string(dir.path().join("calls.jsonl"))
                .unwrap()
                .lines()
                .count(),
            1
        );
    }
    #[tokio::test]
    async fn failed_command_has_one_completion_and_bounded_logs_keep_unicode() {
        let (_dir, e, events) = fixture();
        e.launch(json!({"taskId":"bad","args":["chat","export","-c","failure"]}))
            .await
            .unwrap();
        let task = done(&e, "bad").await;
        assert_eq!(task["state"], "failed");
        assert!(text_value(&task["errorMessage"]).contains("403 forbidden"));
        assert_eq!(
            events
                .lock()
                .unwrap()
                .iter()
                .filter(|(n, v)| n == "tdl:done" && v["taskId"] == "bad")
                .count(),
            1
        );
        e.launch(json!({"taskId":"flood","args":["flood"]}))
            .await
            .unwrap();
        assert_eq!(done(&e, "flood").await["state"], "success");
        let logs = std::fs::read_to_string(e.store.root.join("logs/flood.log")).unwrap();
        assert!(logs.contains("任务完成"));
        assert!(!logs.contains('\u{fffd}'));
        let events = events.lock().unwrap();
        assert!(
            events
                .iter()
                .filter(|(n, v)| n == "tdl:log" && v["taskId"] == "flood")
                .count()
                < 30
        );
    }
    fn text_value(v: &Value) -> String {
        v.as_str().unwrap_or("").into()
    }
    #[tokio::test]
    async fn empty_forward_never_invokes_tdl_and_malformed_forward_fails() {
        let (dir, e, _) = fixture();
        let file = dir.path().join("empty.json");
        write_json(&file, &json!({"messages":[]})).unwrap();
        e.launch(json!({"taskId":"empty","spec":{"kind":"forward","from":file,"target":{"peer":"@target"}}})).await.unwrap();
        assert_eq!(done(&e, "empty").await["state"], "success");
        assert!(!dir.path().join("calls.jsonl").exists());
        std::fs::write(&file, "corrupt").unwrap();
        e.launch(json!({"taskId":"corrupt","spec":{"kind":"forward","from":file}}))
            .await
            .unwrap();
        assert_eq!(done(&e, "corrupt").await["state"], "failed");
        assert!(!dir.path().join("calls.jsonl").exists());
    }
    #[tokio::test]
    async fn native_scheduler_runs_without_a_webview_and_cursor_advances_after_success_only() {
        let (dir, e, _) = fixture();
        let schedule = json!({"id":"watch","name":"watch","type":"export","args":[],"spec":{"kind":"export","chat":"watch","output":dir.path().join("messages.json"),"withContent":true,"all":true},"enabled":true,"mode":"once","nextRunAt":1,"triggerMode":"chat-update","watchChat":"watch","lastSeenMessageId":10});
        e.store
            .update(|d| {
                d["schedules"] = json!([schedule]);
                Ok(())
            })
            .unwrap();
        scheduler::execute(e.clone(), "watch", false).await.unwrap();
        let s = e.store.snapshot()["schedules"][0].clone();
        assert_eq!(s["lastSeenMessageId"], 12);
        assert_eq!(s["runCount"], 1);
        assert_eq!(s["enabled"], false);
        e.store
            .update(|d| {
                let s = &mut d["schedules"][0];
                s["spec"]["chat"] = json!("failure");
                s["lastSeenMessageId"] = json!(10);
                Ok(())
            })
            .unwrap();
        assert!(scheduler::execute(e.clone(), "watch", true).await.is_err());
        assert_eq!(e.store.snapshot()["schedules"][0]["lastSeenMessageId"], 10);
    }
    #[tokio::test]
    async fn comment_export_checkpoints_and_resume_preserve_order() {
        let (dir, e, _) = fixture();
        let work = dir.path().join("comments work");
        let spec = json!({"kind":"comment-forward","sourceChat":"source","workDir":work,"exportOnly":true,"delayMs":0,"skipPostWhenNoComments":true});
        e.launch(json!({"taskId":"comments","spec":spec}))
            .await
            .unwrap();
        assert_eq!(done(&e, "comments").await["state"], "success");
        let p = read_json(&work.join("progress.json")).unwrap();
        assert_eq!(p["done"].as_object().unwrap().len(), 2);
        assert!(p["failed"].as_object().unwrap().is_empty());
        let before = std::fs::read_to_string(dir.path().join("calls.jsonl"))
            .unwrap()
            .lines()
            .count();
        let mut spec = spec;
        spec["resume"] = json!(true);
        spec["skipExistingExport"] = json!(true);
        e.launch(json!({"taskId":"resume","spec":spec}))
            .await
            .unwrap();
        assert_eq!(done(&e, "resume").await["state"], "success");
        assert_eq!(
            std::fs::read_to_string(dir.path().join("calls.jsonl"))
                .unwrap()
                .lines()
                .count(),
            before
        );
    }
    #[tokio::test]
    async fn workflow_runs_steps_in_order_and_stops_after_failure() {
        let (dir, e, _) = fixture();
        let output = dir.path().join("pipeline.json");
        let good = json!({"kind":"workflow","steps":[{"kind":"export","chat":"source","output":output},{"kind":"forward","from":output,"target":{"peer":"@target"},"dryRun":true}]});
        e.launch(json!({"taskId":"pipeline","spec":good}))
            .await
            .unwrap();
        assert_eq!(done(&e, "pipeline").await["state"], "success");
        let calls = std::fs::read_to_string(dir.path().join("calls.jsonl")).unwrap();
        let calls: Vec<Value> = calls
            .lines()
            .map(|s| serde_json::from_str(s).unwrap())
            .collect();
        assert!(calls[0].as_array().unwrap().contains(&json!("export")));
        assert!(calls[1].as_array().unwrap().contains(&json!("forward")));
        assert!(calls[1].as_array().unwrap().contains(&json!("--dry-run")));
        let bad = json!({"kind":"workflow","steps":[{"kind":"export","chat":"failure","output":output},{"kind":"forward","from":output,"target":{"peer":"@target"}}]});
        e.launch(json!({"taskId":"broken_pipeline","spec":bad}))
            .await
            .unwrap();
        assert_eq!(done(&e, "broken_pipeline").await["state"], "failed");
        let calls = std::fs::read_to_string(dir.path().join("calls.jsonl")).unwrap();
        assert_eq!(calls.lines().count(), 3);
    }
    #[tokio::test]
    async fn comment_rehearsal_does_not_write_completion_checkpoints() {
        let (dir, e, events) = fixture();
        let work = dir.path().join("rehearsal");
        e.launch(json!({"taskId":"rehearsal","spec":{"kind":"comment-forward","sourceChat":"source","targetChat":"@target","dryRun":true,"delayMs":0,"workDir":work}})).await.unwrap();
        assert_eq!(done(&e, "rehearsal").await["state"], "success");
        assert!(!work.join("progress.json").exists());
        let stages: Vec<String> = events
            .lock()
            .unwrap()
            .iter()
            .filter(|(n, _)| n == "comment-forward:progress")
            .map(|(_, p)| p["stage"].as_str().unwrap().to_owned())
            .collect();
        assert_eq!(stages.first().unwrap(), "export-list");
        assert_eq!(stages.last().unwrap(), "rehearsal");
        assert!(!stages
            .iter()
            .any(|s| s == "forward-post" || s == "forward-comments" || s == "done"));
        let calls = std::fs::read_to_string(dir.path().join("calls.jsonl")).unwrap();
        assert_eq!(calls.lines().count(), 1);
        assert!(!calls.contains("forward"));
    }
    #[tokio::test]
    async fn stop_all_also_cancels_auxiliary_chat_checks() {
        let (_dir, e, _) = fixture();
        let engine = e.clone();
        let checking = tokio::spawn(async move { engine.latest("slow").await });
        tokio::time::timeout(Duration::from_secs(2), async {
            while !e.has_processes() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        e.stop_all();
        assert!(tokio::time::timeout(Duration::from_secs(2), checking)
            .await
            .unwrap()
            .unwrap()
            .is_err());
        assert!(!e.has_processes());
    }
    // Run explicitly with HOPETDL_ORIGINAL_ROOT pointing to an untouched
    // Electron checkout. Both implementations execute the same fake tdl binary.
    #[tokio::test]
    #[ignore = "requires HOPETDL_ORIGINAL_ROOT for the original Electron worker"]
    async fn comment_worker_matches_original_commands_and_checkpoints() {
        let original = std::env::var("HOPETDL_ORIGINAL_ROOT").expect("set HOPETDL_ORIGINAL_ROOT");
        let cases = vec![
            ("default", json!({})),
            ("export-only", json!({"exportOnly":true,"targetChat":""})),
            ("main-only", json!({"forwardComments":false})),
            ("comments-only", json!({"forwardMain":false})),
            ("without-comments", json!({"includeComments":false})),
            ("start-only", json!({"startId":2})),
            ("end-only", json!({"endId":1})),
            ("descending", json!({"desc":true})),
            ("blocked-group", json!({"blockKeywordsText":"广告"})),
            (
                "blocked-post",
                json!({"blockKeywordsText":"广告","skipCommentsWhenPostBlocked":false}),
            ),
            ("empty-comments", json!({"skipPostWhenNoComments":true})),
            ("topic-fallback", json!({"targetTopicId":123})),
            (
                "topic-failure",
                json!({"targetTopicId":123,"fallbackToDefaultTopicOnMsgIdInvalid":false}),
            ),
            ("continue-failure", json!({"continueOnError":true})),
            ("abort-failure", json!({"continueOnError":false})),
            ("resume", json!({"resume":true})),
            ("cache", json!({"skipExistingExport":true})),
        ];
        for (name, patch) in cases {
            let (dir, e, _) = fixture();
            if name.starts_with("topic-") {
                std::fs::write(dir.path().join("fail-topic"), "").unwrap();
            }
            if name.ends_with("-failure") && !name.starts_with("topic-") {
                std::fs::write(dir.path().join("fail-post"), "").unwrap();
            }
            let old_work = dir.path().join("original");
            let new_work = dir.path().join("rust");
            let mut config = json!({"kind":"comment-forward","sourceChat":"source","targetChat":"@target","mode":"direct","delayMs":0,"globalArgs":["-l","1","--threads","4","-n","hope"],"tdlPath":dir.path().join("fake tdl.py"),"forwardFilterEnabled":false});
            for (k, v) in patch.as_object().unwrap() {
                config[k] = v.clone();
            }
            for work in [&old_work, &new_work] {
                std::fs::create_dir_all(work).unwrap();
                if name == "resume" {
                    write_json(
                        &work.join("progress.json"),
                        &json!({"done":{"1":{"id":1}},"failed":{}}),
                    )
                    .unwrap();
                }
                if name == "cache" {
                    write_json(
                        &work.join("posts.json"),
                        &json!({"id":999,"messages":[{"id":2,"text":"cached"}]}),
                    )
                    .unwrap();
                    write_json(
                        &work.join("queue/post_2.json"),
                        &json!({"id":999,"messages":[{"id":2,"text":"cached"}]}),
                    )
                    .unwrap();
                    write_json(
                        &work.join("comments/comments_2.json"),
                        &json!({"id":999,"messages":[{"id":21,"text":"cached comment"}]}),
                    )
                    .unwrap();
                }
            }
            config["workDir"] = json!(old_work);
            let config_file = dir.path().join("oracle.json");
            write_json(&config_file, &config).unwrap();
            let output=std::process::Command::new("node").args(["-e",r#"
const fs=require('fs'),path=require('path'),Module=require('module');
const filename=path.join(process.argv[1],'electron/commentForwardWorker.cjs');
const m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));
// Current original source calls parseKeywords but omits its import. Shim only
// that missing import in memory, leaving all worker logic untouched.
m._compile("const {parseKeywords}=require('./shared/messageFilter.cjs');\n"+fs.readFileSync(filename,'utf8'),filename);
const worker=new m.exports.CommentForwardWorker(JSON.parse(fs.readFileSync(process.argv[2],'utf8')));
// Original uses delayMs||1500; avoid test sleeps without changing its logic.
worker.config.delayMs=0;let status;worker.on('status',s=>status=s.status);
worker.start().then(()=>console.log(JSON.stringify({status}))).catch(e=>{console.error(e);process.exit(1)});
"#,&original,config_file.to_str().unwrap()]).output().unwrap();
            assert!(
                output.status.success(),
                "{name}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            let old_status: Value = serde_json::from_slice(&output.stdout).unwrap();
            let calls = dir.path().join("calls.jsonl");
            let old_calls = std::fs::read_to_string(&calls)
                .unwrap_or_default()
                .replace(old_work.to_str().unwrap(), "<WORK>");
            std::fs::remove_file(&calls).ok();
            config["workDir"] = json!(new_work);
            e.launch(json!({"taskId":name,"spec":config}))
                .await
                .unwrap();
            let new_status = done(&e, name).await;
            let new_calls = std::fs::read_to_string(&calls)
                .unwrap_or_default()
                .replace(new_work.to_str().unwrap(), "<WORK>");
            assert_eq!(old_calls, new_calls, "command mismatch: {name}");
            assert_eq!(
                old_status["status"] == "done",
                new_status["exitCode"] == 0,
                "status mismatch: {name}"
            );
            for key in ["done", "failed"] {
                let keys = |work: &std::path::Path| -> Vec<String> {
                    let p = read_json(&work.join("progress.json")).unwrap_or(json!({}));
                    p[key]
                        .as_object()
                        .map(|m| m.keys().cloned().collect())
                        .unwrap_or_default()
                };
                assert_eq!(
                    keys(&old_work),
                    keys(&new_work),
                    "checkpoint mismatch: {name}/{key}"
                );
            }
            // Filtered payload contents must match too, not just argv.
            let filtered = old_work.join("filtered");
            if filtered.is_dir() {
                for entry in std::fs::read_dir(filtered).unwrap() {
                    let file = entry.unwrap();
                    assert_eq!(
                        read_json(&file.path()).unwrap(),
                        read_json(&new_work.join("filtered").join(file.file_name())).unwrap(),
                        "payload mismatch: {name}"
                    );
                }
            }
            println!("original parity: {name}");
        }
    }
}

#[test]
fn flood_wait_parser_does_not_mistake_rpc_error_codes_for_seconds() {
    use hopetdl_lib::engine::flood_wait_seconds;
    assert_eq!(flood_wait_seconds("rpc FLOOD_WAIT_32 (code 420)"), Some(32));
    assert_eq!(flood_wait_seconds("FLOOD_WAIT (12)"), Some(12));
    assert_eq!(flood_wait_seconds("FLOOD_WAIT (code 420)"), None);
    assert_eq!(flood_wait_seconds("normal progress 420"), None);
}
