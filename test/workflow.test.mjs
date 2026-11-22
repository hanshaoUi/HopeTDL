import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyDraft,
  validateDraft,
  buildWorkflow,
} from "../shared/workflow.mjs";
const base = () => ({
  ...emptyDraft(),
  sourceChat: "@source",
  targetChat: "@target",
  outputDir: "/tmp/work",
});
test("default workflow transfers posts with comments as one native task", () => {
  const s = buildWorkflow(base(), "test");
  assert.equal(s.kind, "comment-forward");
  assert.equal(s.sourceChat, "@source");
  assert.equal(s.targetChat, "@target");
  assert.equal(s.includeComments, true);
  assert.equal(s.forwardMain, true);
  assert.equal(s.dryRun, true);
});
test("live mode, topics, ID range and resume survive compilation", () => {
  const s = buildWorkflow(
    {
      ...base(),
      runMode: "live",
      topic: "123",
      range: "id",
      startId: "10",
      endId: "20",
      resume: true,
      workDir: "/tmp/previous",
    },
    "test",
  );
  assert.equal(s.dryRun, false);
  assert.equal(s.targetTopicId, 123);
  assert.equal(s.startId, 10);
  assert.equal(s.endId, 20);
  assert.equal(s.workDir, "/tmp/previous");
  assert.equal(s.resume, true);
});
test("post-only transfer exports then forwards the same file", () => {
  const s = buildWorkflow({ ...base(), includeComments: false }, "test");
  assert.equal(s.kind, "workflow");
  assert.deepEqual(
    s.steps.map((s) => s.kind),
    ["export", "forward"],
  );
  assert.equal(s.steps[0].output, s.steps[1].from);
  assert.equal(s.steps[1].dryRun, true);
});
test("chat media download reads messages before downloading", () => {
  const s = buildWorkflow({ ...base(), action: "download" }, "test");
  assert.deepEqual(
    s.steps.map((s) => s.kind),
    ["export", "download"],
  );
  assert.equal(s.steps[0].output, s.steps[1].source.items[0]);
});
test("comment download preserves per-post ordering", () => {
  const s = buildWorkflow(
    { ...base(), action: "download", sourceKind: "comments", mainIds: "12,13" },
    "test",
  );
  assert.deepEqual(
    s.steps.map((s) => s.kind),
    ["export", "download", "export", "download"],
  );
  assert.equal(s.steps[0].reply, "12");
  assert.equal(s.steps[2].reply, "13");
});
test("source validation precedes target and range validation", () => {
  assert.match(validateDraft(emptyDraft(), 0), /源频道/);
  assert.equal(validateDraft({ ...base(), targetChat: "" }, 0), "");
  assert.match(validateDraft({ ...base(), targetChat: "" }, 1), /目标/);
  assert.match(
    validateDraft({ ...base(), range: "id", startId: "20", endId: "10" }, 1),
    /不能大于/,
  );
});
test("invalid URLs and unsafe IDs cannot start a job", () => {
  assert.match(
    validateDraft({
      ...base(),
      action: "download",
      sourceKind: "url",
      links: "https://example.com/x",
    }),
    /Telegram/,
  );
  assert.match(
    validateDraft({
      ...base(),
      range: "id",
      startId: "1",
      endId: "9007199254740992",
    }),
    /有效/,
  );
});
test("local exports bypass export and preserve per-task filters", () => {
  const s = buildWorkflow(
    {
      ...base(),
      sourceKind: "file",
      sourcePath: "/tmp/messages.json",
      keywords: "广告",
    },
    "test",
  );
  assert.equal(s.kind, "forward");
  assert.equal(s.from, "/tmp/messages.json");
  assert.equal(s.filterConfig.blockKeywordsText, "广告");
});
test("uploads retain original files unless removal is selected", () => {
  const s = buildWorkflow(
    {
      ...base(),
      action: "upload",
      sourceKind: "file",
      sourcePath: "/tmp/media.mp4",
    },
    "test",
  );
  assert.equal(s.remove, false);
  assert.equal(s.path, "/tmp/media.mp4");
});

test('global matching settings are inherited when no local keywords are supplied', () => {
 const s=buildWorkflow(base(),'test');assert.equal('keywordCaseSensitive' in s,false);assert.equal('keywordRegexMode' in s,false)
 const local=buildWorkflow({...base(),keywords:'广告',caseSensitive:true},'test');assert.equal(local.keywordCaseSensitive,true)
})
