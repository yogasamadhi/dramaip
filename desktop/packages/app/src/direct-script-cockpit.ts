import type { Project } from "@dramaip/contracts/product";
import type {
  DirectScriptSource,
  EpisodeDevelopmentResult,
} from "@dramaip/contracts/production";
import type { DirectScriptCockpitEvidence } from "./direct-script-cockpit-evidence";
import type { ProjectCockpit, ProjectCockpitAction } from "./project-cockpit";
import { selectUnresolvedCreationWorkflow } from "./unresolved-creation-workflow";

type Gate = NonNullable<ProjectCockpit["gates"]>[number];
type Ref = { id: string; version: number };
const same = (a: Ref | undefined, b: Ref | undefined) =>
  Boolean(a && b && a.id === b.id && a.version === b.version);
const sameDirect = (a?: DirectScriptSource, b?: DirectScriptSource) =>
  Boolean(
    a &&
    b &&
    a.entryPath === b.entryPath &&
    same(a.project, b.project) &&
    same(a.authorIntent, b.authorIntent) &&
    same(a.episode, b.episode) &&
    a.durationSeconds === b.durationSeconds &&
    ((!a.sourceScript && !b.sourceScript) ||
      (same(a.sourceScript, b.sourceScript) &&
        a.sourceScript?.documentVersion === b.sourceScript?.documentVersion)),
  );
const latest = <T extends { id: string; createdAt: string }>(items: T[]) =>
  [...items].sort(
    (a, b) =>
      b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
  )[0];
const issues = (item?: EpisodeDevelopmentResult) =>
  item?.staleReasons.length
    ? ` 已知失效：${item.staleReasons.slice(0, 2).join("；")}。`
    : "";

export function deriveDirectScriptCockpit(
  project: Project,
  evidence?: DirectScriptCockpitEvidence,
): ProjectCockpit {
  const tool = (
    name: string,
    values: Record<string, string | undefined> = {},
  ) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(values))
      if (value) params.set(key, value);
    return `/projects/${encodeURIComponent(project.id)}/tools/${name}${params.size ? `?${params}` : ""}`;
  };
  const names = [
    "直写来源与作者意图",
    "首集单集大纲",
    "首集标准剧本",
    "首集分镜与内部包",
  ];
  const gates: Gate[] = [];
  const actions: ProjectCockpitAction[] = [];
  const add = (
    status: Gate["status"],
    statusLabel: string,
    detail: string,
    label: string,
    to: string,
  ) => {
    gates.push({
      id: `direct-${gates.length + 1}`,
      label: names[gates.length]!,
      status,
      statusLabel,
      detail,
      to,
    });
    actions.push({ label, description: detail, to });
  };
  if (!evidence) {
    for (const [index, operation] of [
      undefined,
      "episode-outline",
      "episode-script",
      "storyboard-package",
    ].entries())
      add(
        "unverified",
        "正式状态尚未核验",
        "正在读取实际直写来源、完整正式版本与保存回执；目录、媒体计数或任务成功不能代替采用证据。",
        "核对直写正式进度",
        tool(index ? "episode-development" : "author-intent", { operation }),
      );
    return finish();
  }
  const sources = evidence.sources;
  const direct = sources.direct;
  const intent = evidence.intent.current;
  const ordered = [...(direct?.episodes ?? [])].sort(
    (a, b) => a.orderIndex - b.orderIndex || a.id.localeCompare(b.id),
  );
  const first = ordered[0];
  const entryPath =
    project.modeConfig.mode === "single_season"
      ? project.modeConfig.entryPath
      : undefined;
  const owned =
    sources.projectId === project.id &&
    (!intent || intent.projectId === project.id);
  const catalogValid = Boolean(
    owned &&
    direct &&
    !sources.seasonPlan &&
    sources.episodes.length === 0 &&
    same(direct.project, project) &&
    direct.entryPath === entryPath &&
    new Set(ordered.map((item) => item.id)).size === ordered.length &&
    new Set(ordered.map((item) => item.orderIndex)).size === ordered.length &&
    ordered.every(
      (item) =>
        new Set(item.scripts.map((script) => script.id)).size ===
        item.scripts.length,
    ),
  );
  const intentReady = Boolean(
    catalogValid &&
    intent?.isCurrent &&
    intent.status === "adopted" &&
    intent.adoptedAt &&
    intent.sourceState === "current" &&
    same(direct?.authorIntent, intent),
  );
  const actualSourceReady = Boolean(
    first &&
    (entryPath === "script"
      ? first.scripts.length > 0
      : project.synopsis?.trim() || project.productionBrief?.trim()),
  );
  const sourceReady =
    catalogValid &&
    intentReady &&
    actualSourceReady &&
    sources.storyBibleCount > 0;
  const developmentTo = (
    operation: string,
    values: Record<string, string | undefined> = {},
  ) =>
    tool("episode-development", { episodeId: first?.id, operation, ...values });
  const sourceParams = new URLSearchParams({
    projectId: project.id,
    stage: "scripts",
  });
  if (project.currentAdaptationId)
    sourceParams.set("adaptationId", project.currentAdaptationId);
  if (first) sourceParams.set("episodeId", first.id);
  add(
    sourceReady
      ? "ready"
      : !catalogValid
        ? "unverified"
        : intent?.sourceState === "stale"
          ? "stale"
          : "pending",
    sourceReady
      ? `正式意图 v${intent!.version} · 已批准故事圣经`
      : "实际来源、正式意图或故事圣经待确认",
    `${first ? `当前首集 ${first.title}（${first.id}）v${first.version}` : "无可核验的实际分集"}；${entryPath === "script" ? `${first?.scripts.length ?? 0} 份有正文的实际原稿` : "实际创意简报"}。${sourceReady ? "明确采用意图与批准故事圣经，不补小说、诊断或季纲" : "旧字段、空稿和候选不等于正式采用"}；权利声明不是授权证明核验。`,
    !catalogValid
      ? "核对直写正式来源"
      : !actualSourceReady
        ? "补充实际直写来源"
        : !intentReady
          ? "确认直写作者意图"
          : "采用正式故事圣经",
    !catalogValid
      ? tool("author-intent", { intentId: intent?.id })
      : !actualSourceReady
        ? `/adapt?${sourceParams}`
        : !intentReady
          ? tool("author-intent", { intentId: intent?.id })
          : developmentTo("episode-outline"),
  );

  const rootValid = (root?: DirectScriptSource) =>
    Boolean(
      sourceReady &&
      root &&
      first &&
      root.entryPath === entryPath &&
      same(root.project, project) &&
      same(root.authorIntent, intent) &&
      same(root.episode, first) &&
      Number.isInteger(root.durationSeconds) &&
      root.durationSeconds >= 30 &&
      root.durationSeconds <= 1800 &&
      (root.sourceScript
        ? first.scripts.some(
            (item) =>
              same(item, root.sourceScript) &&
              item.documentVersion === root.sourceScript!.documentVersion,
          )
        : entryPath === "inspiration"),
    );
  const head = (operation: EpisodeDevelopmentResult["operation"]) => {
    const matches = evidence.episodes.filter(
      (item) =>
        item.projectId === project.id &&
        item.episodeId === first?.id &&
        item.operation === operation &&
        item.isCurrent,
    );
    const catalog = sources.currentResults.filter(
      (item) =>
        item.projectId === project.id &&
        item.episodeId === first?.id &&
        item.operation === operation,
    );
    const value = matches.length === 1 ? matches[0] : undefined;
    // Concurrent reads may observe different heads. Never select one silently.
    const mirror = catalog[0];
    const ambiguous =
      matches.length > 1 ||
      catalog.length > 1 ||
      Boolean(value) !== Boolean(catalog.length) ||
      Boolean(
        value &&
        (!same(value, mirror) ||
          !mirror?.isCurrent ||
          value.sourceState !== mirror.sourceState ||
          !sameDirect(
            value.basis.request.direct,
            mirror.basis.request.direct,
          ) ||
          value.scriptId !== mirror.scriptId ||
          value.scriptDocumentVersion !== mirror.scriptDocumentVersion ||
          value.episodeRecordId !== mirror.episodeRecordId),
      );
    return { value, ambiguous };
  };
  const baseValid = (value?: EpisodeDevelopmentResult) =>
    Boolean(
      value &&
      value.isCurrent &&
      value.adoptedAt &&
      value.sourceState === "current" &&
      value.content.kind === value.operation &&
      rootValid(value.basis.request.direct) &&
      !value.basis.request.seasonPlan &&
      !value.basis.diagnosis &&
      value.basis.chapters.length === 0 &&
      value.basis.request.episodeId === first?.id &&
      "sourcePath" in value.basis.episode &&
      value.basis.episode.sourcePath === "direct-script" &&
      same(value.basis.episode, first) &&
      value.basis.episode.durationSeconds ===
        value.basis.request.direct?.durationSeconds &&
      same(value.basis.authorIntent, intent),
    );
  const outline = head("episode-outline");
  const script = head("episode-script");
  const storyboard = head("storyboard-package");
  const outlineReady = !outline.ambiguous && baseValid(outline.value);
  const scriptReady =
    outlineReady &&
    !script.ambiguous &&
    baseValid(script.value) &&
    sameDirect(
      script.value?.basis.request.direct,
      outline.value?.basis.request.direct,
    ) &&
    same(script.value?.basis.request.outline, outline.value) &&
    Boolean(script.value?.scriptId) &&
    script.value?.episodeRecordId === first?.id &&
    script.value?.scriptDocumentVersion !== undefined;
  const storyboardReady =
    scriptReady &&
    !storyboard.ambiguous &&
    baseValid(storyboard.value) &&
    sameDirect(
      storyboard.value?.basis.request.direct,
      outline.value?.basis.request.direct,
    ) &&
    same(storyboard.value?.basis.request.outline, outline.value) &&
    same(storyboard.value?.basis.request.script, script.value) &&
    storyboard.value?.scriptId === script.value?.scriptId &&
    storyboard.value?.episodeRecordId === first?.id &&
    storyboard.value?.scriptDocumentVersion ===
      script.value?.scriptDocumentVersion &&
    Boolean(
      storyboard.value?.productionRecords?.some(
        (item) => item.kind === "scenes",
      ) &&
      storyboard.value.productionRecords.some(
        (item) => item.kind === "shots",
      ) &&
      new Set(storyboard.value.productionRecords.map((item) => item.id))
        .size === storyboard.value.productionRecords.length,
    );
  addFormal(
    "episode-outline",
    outline,
    outlineReady,
    sourceReady,
    "开发首集单集大纲",
    "大纲须明确冻结实际简报／原稿、意图、真实分集与目标时长，并审阅采用；无需先写小说。" +
      issues(outline.value),
  );
  addFormal(
    "episode-script",
    script,
    scriptReady,
    outlineReady,
    "开发首集标准剧本",
    "剧本须继承同一正式大纲及直写来源，在实际分集下保留稳定块；原稿不覆盖，文学质量另行评议。" +
      issues(script.value),
  );

  const matchingPackages = evidence.packages.filter(
    (item) =>
      storyboardReady &&
      item.manifest.purpose === "internal-pilot" &&
      item.manifest.projectId === project.id &&
      item.sourceState === "current" &&
      !item.sourceIssues.length &&
      item.manifest.projectVersion === project.version &&
      item.manifest.episodeId === first?.id &&
      !item.manifest.adopted.diagnosis &&
      !item.manifest.adopted.seasonPlan &&
      sameDirect(
        item.manifest.adopted.directSource,
        outline.value?.basis.request.direct,
      ) &&
      item.manifest.durationSeconds ===
        outline.value?.basis.request.direct?.durationSeconds &&
      same(item.manifest.adopted.authorIntent, intent) &&
      same(item.manifest.adopted.outline, outline.value) &&
      same(item.manifest.adopted.script, script.value) &&
      same(item.manifest.adopted.storyboard, storyboard.value) &&
      item.manifest.scriptRecordId === script.value?.scriptId &&
      item.manifest.scriptDocumentVersion ===
        script.value?.scriptDocumentVersion &&
      item.manifest.productionRecords.length ===
        storyboard.value?.productionRecords?.length &&
      new Set(item.manifest.productionRecords.map((record) => record.id))
        .size === item.manifest.productionRecords.length &&
      item.manifest.productionRecords.every((record) =>
        storyboard.value?.productionRecords?.some(
          (current) =>
            same(record, current) &&
            record.kind === current.kind &&
            record.stableId === current.stableId,
        ),
      ),
  );
  const saved = latest(
    matchingPackages.filter(
      (item) =>
        item.status === "saved" &&
        item.rights?.confirmed &&
        item.receipt?.artifactRef &&
        item.receipt.savedAt &&
        item.receipt.sha256 === item.archive.sha256 &&
        item.receipt.byteSize === item.archive.byteSize &&
        item.receipt.byteSize > 0 &&
        !item.manifest.preflight.blockers.length &&
        !item.manifest.preflight.checks.some(
          (check) => check.state === "blocked",
        ),
    ),
  );
  const preview = latest(
    matchingPackages.filter((item) =>
      ["awaiting-confirmation", "saving", "failed"].includes(item.status),
    ),
  );
  const packageTo = developmentTo("storyboard-package", {
    pilotPackageId: (saved ?? preview)?.id,
  });
  if (saved)
    add(
      "ready",
      "内部试制包已保存 · 非发行就绪",
      `分镜 v${storyboard.value!.version} → 内部包 v${saved.version}；${saved.receipt!.byteSize} 字节保存回执与摘要一致。语义质量、授权证明、费用及媒体可能仍未核验；保存不是发行批准。`,
      "查看内部试制包回执",
      packageTo,
    );
  else if (storyboardReady)
    add(
      preview?.status === "saving"
        ? "working"
        : preview
          ? "needs-human"
          : "pending",
      preview?.status === "saving"
        ? "内部试制包正在保存"
        : preview?.status === "failed"
          ? "内部试制包保存失败"
          : "正式分镜已采用，内部包待保存",
      "核对实际清单、阻断项与权利声明，并取得 Host 保存回执；预览、取消或保存失败不代表交付。未知项不标通过，不要求生成媒体。",
      "核验并保存内部试制包",
      packageTo,
    );
  else
    addFormal(
      "storyboard-package",
      storyboard,
      false,
      Boolean(scriptReady),
      "开发首集分镜包",
      "分镜须绑定当前正式剧本、同一来源和实际稳定块，再明确确认内部用途与权利并保存；其他集或旧版本包不能替代。" +
        issues(storyboard.value),
    );
  return finish();

  function workflow(operation: EpisodeDevelopmentResult["operation"]) {
    return selectUnresolvedCreationWorkflow(
      evidence!.workflows.filter((item) => {
        const request = item.input.episodeDevelopmentRequest;
        return (
          item.input.projectId === project.id &&
          item.input.operation === operation &&
          request &&
          rootValid(request.direct) &&
          !request.seasonPlan &&
          request.episodeId === first?.id &&
          (operation === "episode-outline"
            ? request.baseOutlineId === outline.value?.id
            : sameDirect(request.direct, outline.value?.basis.request.direct) &&
              same(request.outline, outline.value)) &&
          (operation !== "episode-script" ||
            request.baseScriptId === script.value?.id) &&
          (operation !== "storyboard-package" ||
            (same(request.script, script.value) &&
              request.baseStoryboardId === storyboard.value?.id &&
              request.baseScriptDocumentVersion ===
                script.value?.scriptDocumentVersion))
        );
      }),
    );
  }
  function addFormal(
    operation: EpisodeDevelopmentResult["operation"],
    result: ReturnType<typeof head>,
    ready: unknown,
    upstream: boolean,
    action: string,
    detail: string,
  ) {
    const to = developmentTo(operation);
    if (result.ambiguous)
      return add(
        "unverified",
        "正式采用头或读取快照不一致",
        "正式来源目录与完整采用历史未能核对同一唯一版本，不能任选一个显示完成。",
        action,
        to,
      );
    if (ready)
      return add(
        "ready",
        `已采用${operation === "episode-outline" ? "大纲" : "标准剧本"} v${result.value!.version}`,
        `${first!.title}（${first!.id}）· 正式版本 v${result.value!.version}。${detail}`,
        action,
        to,
      );
    const run = upstream ? workflow(operation) : undefined;
    if (run) {
      const pending = run.stage === "awaiting-review";
      const failed = ["failed", "interrupted"].includes(run.stage);
      return add(
        pending ? "needs-human" : failed ? "stale" : "working",
        pending
          ? "候选等待明确采用"
          : failed
            ? "本阶段运行需要处理"
            : "本阶段正在生成与检查",
        `${detail} 候选或运行成功不等于正式采用；不跳过检查或自动推进。`,
        pending
          ? "审阅并采用本阶段候选"
          : failed
            ? "处理本阶段失败运行"
            : "查看本阶段运行",
        developmentTo(operation, { workflowId: run.id }),
      );
    }
    add(
      result.value ? "stale" : "pending",
      result.value
        ? `正式历史 v${result.value.version} 来源已变化`
        : "尚无当前正式采用成果",
      detail,
      action,
      to,
    );
  }
  function finish(): ProjectCockpit {
    const index = gates.findIndex((item) => item.status !== "ready");
    const gate = gates[index];
    const status =
      index < 0
        ? "delivered"
        : gate!.status === "working"
          ? "working"
          : gate!.status === "needs-human"
            ? "needs-human"
            : ["stale", "unverified"].includes(gate!.status)
              ? "needs-attention"
              : "needs-input";
    return {
      status,
      statusLabel:
        index < 0
          ? "内部试制包已保存，发行仍待核验"
          : `${gate!.label} · ${gate!.statusLabel}`,
      primaryAction: index < 0 ? actions[3]! : actions[index]!,
      blockers: index < 0 ? [] : [gate!.detail],
      recentResult:
        [...gates].reverse().find((item) => item.status === "ready")
          ?.statusLabel ?? "尚无当前可核验的正式采用成果。",
      coverage: [
        {
          label: "当前正式 Gate",
          current: gates.filter((item) => item.status === "ready").length,
          required: 4,
        },
      ],
      gates,
    };
  }
}
