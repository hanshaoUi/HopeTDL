const ACTIONS = {
  transfer: {
    title: "搬运消息",
    description: "主消息与评论，按原有顺序一起搬运。",
    icon: "transfer",
  },
  download: {
    title: "下载媒体",
    description: "选择消息来源，将媒体文件保存到本地。",
    icon: "download",
  },
  export: {
    title: "导出记录",
    description: "将对话中的消息记录保存为可继续使用的文件。",
    icon: "export",
  },
  upload: {
    title: "上传文件",
    description: "将本地文件上传到指定对话与话题。",
    icon: "upload",
  },
};
export { ACTIONS };
export function emptyDraft() {
  return {
    action: "transfer",
    sourceKind: "chat",
    sourceChat: "",
    sourcePath: "",
    links: "",
    mainIds: "",
    targetChat: "",
    topic: "",
    range: "all",
    startId: "",
    endId: "",
    includeMain: true,
    includeComments: true,
    outputDir: "",
    exportFile: "",
    runMode: "rehearsal",
    transferMode: "clone",
    keywords: "",
    caseSensitive: false,
    regexMode: false,
    skipNoComments: false,
    skipBlockedComments: true,
    resume: false,
    workDir: "",
    skipExisting: true,
    desc: false,
    delayMs: 1500,
    continueOnError: true,
    include: "",
    exclude: "",
    template: "",
    group: true,
    skipSame: true,
    rewriteExt: false,
    takeout: false,
    resumeMode: "continue",
    caption: "",
    photo: false,
    remove: false,
    raw: false,
    step: 0,
  };
}
function id(value) {
  return /^\d+$/.test(String(value)) && BigInt(value) <= 9007199254740991n;
}
export function validateDraft(d, step = 2) {
  if (!ACTIONS[d.action]) return "请选择要执行的操作";
  if (
    (d.sourceKind === "chat" || d.sourceKind === "comments") &&
    !String(d.sourceChat).trim()
  )
    return "请先选择或填写源频道 / 群组";
  if (d.sourceKind === "file" && !String(d.sourcePath).trim())
    return "请选择本地来源文件";
  if (d.sourceKind === "url") {
    const links = String(d.links)
      .split(/\r?\n/)
      .filter((s) => s.trim());
    if (
      !links.length ||
      links.some((s) => !/^https:\/\/(?:t\.me|telegram\.me)\//i.test(s.trim()))
    )
      return "请填写有效的 Telegram 消息链接，每行一条";
  }
  if (
    d.sourceKind === "comments" &&
    (!String(d.mainIds).trim() ||
      String(d.mainIds)
        .split(/[\s,，]+/)
        .some((s) => !id(s)))
  )
    return "请填写评论区所属的主消息 ID，以逗号或换行分隔";
  if (step === 0) return "";
  if (["transfer", "upload"].includes(d.action) && !String(d.targetChat).trim())
    return "请选择目标群组 / 对话";
  if (String(d.topic).trim() && !id(d.topic))
    return "话题 ID 需要是有效的非负整数";
  if (
    d.action === "transfer" &&
    !d.includeMain &&
    !d.includeComments &&
    d.sourceKind === "chat"
  )
    return "请至少选择主消息或评论区";
  if (
    ["transfer", "export", "download"].includes(d.action) &&
    d.sourceKind === "chat" &&
    d.range === "id"
  ) {
    if (!id(d.startId) || !id(d.endId)) return "请填写有效的起始 ID 和结束 ID";
    if (BigInt(d.startId) > BigInt(d.endId)) return "起始 ID 不能大于结束 ID";
  }
  if (
    ["download", "upload", "transfer"].includes(d.action) &&
    !String(d.outputDir).trim() &&
    d.action !== "upload"
  )
    return "请设置本地保存 / 工作目录";
  if (d.action === "export" && !String(d.exportFile).trim())
    return "请选择导出记录的保存位置";
  if (d.resume && !String(d.workDir).trim())
    return "继续上次搬运需要选择原来的工作目录";
  return "";
}
function join(dir, file) {
  const sep = dir.includes("\\") ? "\\" : "/";
  return `${dir.replace(/[\\/]+$/, "")}${sep}${file}`;
}
export function buildWorkflow(d, token) {
  const error = validateDraft(d);
  if (error) throw new Error(error);
  const folder = join(d.outputDir || ".", `transfer-${token}`);
  const exported = join(folder, "messages.json");
  const selector =
    d.range === "id"
      ? { type: "id", input: `${d.startId},${d.endId}` }
      : { type: "all" };
  const exp = (output) => ({
    kind: "export",
    chat: d.sourceChat.trim(),
    selector,
    all: true,
    withContent: true,
    raw: d.raw,
    output,
  });
  const filterConfig = {
    blockKeywordsText: d.keywords,
    ...(d.keywords.trim() ? {keywordCaseSensitive:d.caseSensitive, keywordRegexMode:d.regexMode} : {}),
  };
  const target = {
    peer: d.targetChat.trim(),
    thread: String(d.topic).trim() || null,
  };
  const forward = (from) => ({
    kind: "forward",
    from,
    target,
    mode: d.transferMode,
    dryRun: d.runMode === "rehearsal",
    desc: d.desc,
  });
  const download = (source) => ({
    kind: "download",
    directory: d.outputDir,
    include: d.include,
    exclude: d.exclude,
    template: d.template,
    group: d.group,
    skipSame: d.skipSame,
    rewriteExt: d.rewriteExt,
    takeout: d.takeout,
    desc: d.desc,
    resumeMode: d.resumeMode,
    source,
  });
  if (d.action === "transfer") {
    if (d.sourceKind === "file")
      return { ...forward(d.sourcePath), filterConfig };
    if (d.includeComments)
      return {
        kind: "comment-forward",
        sourceChat: d.sourceChat.trim(),
        targetChat: d.targetChat.trim(),
        targetTopicId: d.topic ? Number(d.topic) : null,
        startId: d.range === "id" ? Number(d.startId) : null,
        endId: d.range === "id" ? Number(d.endId) : null,
        includeComments: true,
        forwardMain: d.includeMain,
        forwardComments: true,
        dryRun: d.runMode === "rehearsal",
        mode: d.transferMode,
        workDir: d.workDir || folder,
        resume: d.resume,
        skipExistingExport: d.skipExisting,
        delayMs: d.delayMs,
        continueOnError: d.continueOnError,
        desc: d.desc,
        skipPostWhenNoComments: d.skipNoComments,
        skipCommentsWhenPostBlocked: d.skipBlockedComments,
        blockKeywordsText: d.keywords,
        ...(d.keywords.trim() ? {keywordCaseSensitive:d.caseSensitive, keywordRegexMode:d.regexMode} : {}),
      };
    return {
      kind: "workflow",
      steps: [exp(exported), forward(exported)],
      filterConfig,
    };
  }
  if (d.action === "export") return exp(d.exportFile);
  if (d.action === "upload")
    return {
      kind: "upload",
      path: d.sourcePath,
      chat: d.targetChat.trim(),
      topic: d.topic || "",
      caption: d.caption,
      photo: d.photo,
      remove: d.remove,
    };
  if (d.sourceKind === "chat")
    return {
      kind: "workflow",
      steps: [exp(exported), download({ type: "file", items: [exported] })],
    };
  if (d.sourceKind === "comments") {
    const ids = [
      ...new Set(
        String(d.mainIds)
          .split(/[\s,，]+/)
          .filter(Boolean),
      ),
    ];
    return {
      kind: "workflow",
      steps: ids.flatMap((id) => {
        const file = join(folder, `comments-${id}.json`);
        return [
          {
            kind: "export",
            chat: d.sourceChat.trim(),
            reply: id,
            all: true,
            withContent: true,
            output: file,
          },
          download({ type: "file", items: [file] }),
        ];
      }),
    };
  }
  return download(
    d.sourceKind === "url"
      ? {
          type: "url",
          items: d.links
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean),
        }
      : { type: "file", items: [d.sourcePath] },
  );
}
