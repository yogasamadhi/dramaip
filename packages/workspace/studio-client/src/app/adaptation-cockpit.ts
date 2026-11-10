import type { Project } from "@dramaip/contracts/product";
import type { CreationWorkflow } from "@dramaip/contracts/creation";
import type { EpisodeDevelopmentResult } from "@dramaip/contracts/production";
import type { AdaptationCockpitEvidence } from "./adaptation-cockpit-evidence";
import type { ProjectCockpit, ProjectCockpitAction } from "./project-cockpit";
import { selectUnresolvedCreationWorkflow } from "./unresolved-creation-workflow";

type Gate = NonNullable<ProjectCockpit["gates"]>[number];
type Ref = { id: string; version: number };
const same = (left: Ref | undefined, right: Ref | undefined) =>
  Boolean(
    left && right && left.id === right.id && left.version === right.version,
  );
const latest = <T extends { createdAt: string; id: string }>(items: T[]) =>
  [...items].sort(
    (a, b) =>
      b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
  );
const issues = (value?: { staleReasons: string[] }) =>
  value?.staleReasons?.length
    ? ` 已知失效：${value.staleReasons.slice(0, 2).join("；")}。`
    : "";

export function deriveAdaptationCockpit(
  project: Project,
  evidence?: AdaptationCockpitEvidence,
): ProjectCockpit {
  const tool = (
    name: string,
    params: Record<string, string | undefined> = {},
  ) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params))
      if (value) query.set(key, value);
    return `/projects/${encodeURIComponent(project.id)}/tools/${name}${query.size ? `?${query}` : ""}`;
  };
  const sourceTo = tool("author-intent", {
    intentId: evidence?.intent.current?.id,
  });
  const names = [
    "来源与作者意图",
    "改编诊断",
    "独立改编策略",
    "整季分集方案",
    "首集剧本",
    "首集分镜试制包",
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
      id: `adaptation-${gates.length + 1}`,
      label: names[gates.length]!,
      status,
      statusLabel,
      detail,
      to,
    });
    actions.push({ label, description: detail, to });
  };
  if (!evidence) {
    for (const name of [
      "author-intent",
      "adaptation-diagnosis",
      "adaptation-strategy",
      "season-plan",
      "episode-development",
      "episode-development",
    ])
      add(
        "unverified",
        "正式状态尚未核验",
        "正在读取完整正式版本与保存回执；目录、计数或任务成功不能代替采用证据。",
        "核对正式创作进度",
        tool(name),
      );
    return finish();
  }
  const intent = evidence.intent.current;
  const sources = evidence.sources;
  const owned =
    sources.projectId === project.id &&
    (!intent || intent.projectId === project.id);
  const sourceReady =
    owned &&
    sources.chapters.length > 0 &&
    intent?.isCurrent &&
    intent.status === "adopted" &&
    intent.sourceState === "current" &&
    Boolean(intent.adoptedAt) &&
    same(sources.authorIntent, intent);
  add(
    sourceReady
      ? "ready"
      : !owned
        ? "unverified"
        : intent?.sourceState === "stale"
          ? "stale"
          : "pending",
    sourceReady
      ? `正式作者意图 v${intent!.version}`
      : "来源或正式作者意图待确认",
    `${sources.chapters.length} 章有正文来源；${sourceReady ? "作者意图已明确采用" : "旧字段、目录和候选不等于正式意图"}。权利声明不等于授权证明核验。`,
    sources.chapters.length ? "确认来源与作者意图" : "补充实际来源正文",
    sources.chapters.length
      ? sourceTo
      : `/projects/${encodeURIComponent(project.id)}`,
  );

  const diagnosisHeads = evidence.diagnoses.filter(
    (item) =>
      item.projectId === project.id &&
      item.isCurrent &&
      item.status === "adopted",
  );
  const diagnosis = diagnosisHeads.length === 1 ? diagnosisHeads[0] : undefined;
  // New projects use independent stages. Only real same-project legacy plan
  // evidence keeps the old five-Gate chain; an old diagnostic proposal alone
  // is not a reason to recommend the broad compatibility path.
  const independentPath = Boolean(
    !diagnosis?.selectedStrategyId ||
    (evidence.strategies ?? []).some((item) => item.projectId === project.id) ||
    evidence.workflows.some(
      (item) =>
        item.input.projectId === project.id &&
        item.input.operation === "adaptation-strategy",
    ) ||
    !(
      evidence.plans.some(
        (item) => item.projectId === project.id && !item.basis.strategy,
      ) ||
      evidence.workflows.some(
        (item) =>
          item.input.projectId === project.id &&
          item.input.operation === "season-plan" &&
          !item.input.seasonPlanRequest?.strategy,
      )
    ),
  );
  if (!independentPath) names.splice(2, 1);
  const diagnosisReady =
    sourceReady &&
    diagnosis &&
    diagnosis.sourceState === "current" &&
    Boolean(diagnosis.adoptedAt) &&
    sources.adoptedDiagnosisId === diagnosis.id &&
    same(diagnosis.authorIntent, intent) &&
    (independentPath ||
      diagnosis.content.strategies.some(
        (item) => item.id === diagnosis.selectedStrategyId,
      )) &&
    diagnosis.basis.chapters.every((item) =>
      sources.chapters.some(
        (current) =>
          same(current, item) && current.contentHash === item.contentHash,
      ),
    );
  const diagnosisTo = tool("adaptation-diagnosis", {
    diagnosisId: diagnosis?.id,
  });
  const diagnosisWorkflow = workflow("adaptation-diagnosis", (item) => {
    const request = item.input.diagnosisRequest;
    return Boolean(
      sourceReady &&
      request &&
      same(request.authorIntent, intent) &&
      request.inventoryFingerprint === sources.inventoryFingerprint &&
      request.baseAdoptedId === diagnosis?.id &&
      request.chapters.every((ref) =>
        sources.chapters.some((chapter) => same(chapter, ref)),
      ),
    );
  });
  const pendingDiagnosis = latest(
    evidence.diagnoses.filter(
      (item) =>
        item.projectId === project.id &&
        item.status === "pending" &&
        item.sourceState === "current" &&
        same(item.authorIntent, intent) &&
        item.basis.baseAdoptedId === diagnosis?.id,
    ),
  )[0];
  addFormal(
    diagnosisReady,
    diagnosisHeads.length > 1,
    Boolean(diagnosis),
    Boolean(diagnosis && !diagnosisReady),
    diagnosisReady
      ? `已采用诊断 v${diagnosis!.version}${independentPath ? " · 叙事证据已确认" : ` · 兼容策略 ${diagnosis!.selectedStrategyId}`}`
      : "正式诊断尚未就绪",
    diagnosis
      ? `诊断 v${diagnosis.version} · 实际范围 ${diagnosis.basis.chapters.length}/${diagnosis.basis.chapters.length + diagnosis.basis.omittedChapters.length} 章；${diagnosis.basis.sourceBasis ? "明确摘要／原文／段落表达，不证明全文已读" : "冻结原文范围，不证明语义质量"}。${diagnosisReady ? "" : "来源或采用头须重新核对。"}${issues(diagnosis)}`
      : "须先确认实际来源与意图，再生成、检查并明确采用诊断；新主流程在下一步单独选择独立策略。",
    "确认改编诊断",
    diagnosisTo,
    diagnosisWorkflow,
    Boolean(sourceReady),
    pendingDiagnosis
      ? tool("adaptation-diagnosis", { diagnosisId: pendingDiagnosis.id })
      : undefined,
  );

  const strategyHeads = (evidence.strategies ?? []).filter(
    (item) =>
      item.projectId === project.id &&
      item.isCurrent &&
      item.status === "adopted",
  );
  const selectedStrategy =
    strategyHeads.length === 1 ? strategyHeads[0] : undefined;
  const strategyReady = Boolean(
    diagnosisReady &&
    selectedStrategy?.sourceState === "current" &&
    selectedStrategy.adoptedAt &&
    same(selectedStrategy.basis.diagnosis, diagnosis) &&
    same(selectedStrategy.basis.authorIntent, intent) &&
    selectedStrategy.content.options.some(
      (option) => option.id === selectedStrategy.selectedOptionId,
    ),
  );
  const optionId = independentPath
    ? selectedStrategy?.selectedOptionId
    : diagnosis?.selectedStrategyId;
  const strategyBinding = (reference?: Ref & { optionId: string }) =>
    independentPath
      ? strategyReady &&
        same(reference, selectedStrategy) &&
        reference?.optionId === optionId
      : !reference;
  if (independentPath) {
    const pending = latest(
      (evidence.strategies ?? []).filter(
        (item) =>
          item.projectId === project.id &&
          item.status === "pending" &&
          item.sourceState === "current" &&
          same(item.basis.diagnosis, diagnosis) &&
          item.basis.baseAdoptedId === selectedStrategy?.id,
      ),
    )[0];
    const running = workflow("adaptation-strategy", (item) =>
      Boolean(
        diagnosisReady &&
        same(item.input.adaptationStrategyRequest?.diagnosis, diagnosis) &&
        item.input.adaptationStrategyRequest?.baseAdoptedId ===
          selectedStrategy?.id,
      ),
    );
    addFormal(
      strategyReady,
      strategyHeads.length > 1,
      Boolean(selectedStrategy),
      Boolean(selectedStrategy && !strategyReady),
      strategyReady
        ? `已采用独立策略 v${selectedStrategy!.version} · ${optionId}`
        : "独立策略待确认",
      "比较 2–3 个不同叙事动作；只采用一个，旧诊断内选项不代替独立正式版本。",
      "确认独立改编策略",
      tool("adaptation-strategy", {
        strategyId: selectedStrategy?.id,
        workflowId: selectedStrategy?.workflowId,
      }),
      running,
      Boolean(diagnosisReady),
      pending
        ? tool("adaptation-strategy", {
            strategyId: pending.id,
            workflowId: pending.workflowId,
          })
        : undefined,
    );
  }
  const planHeads = evidence.plans.filter(
    (item) =>
      item.projectId === project.id &&
      item.isCurrent &&
      item.status === "adopted",
  );
  const plan = planHeads.length === 1 ? planHeads[0] : undefined;
  const episodeOrder = [...(plan?.content.episodes ?? [])].sort(
    (a, b) => a.orderIndex - b.orderIndex,
  );
  const first = episodeOrder[0];
  const planReady =
    diagnosisReady &&
    plan &&
    plan.sourceState === "current" &&
    Boolean(plan.adoptedAt) &&
    same(plan.basis.authorIntent, intent) &&
    same(plan.basis.diagnosis, diagnosis) &&
    plan.basis.diagnosis.strategyId === optionId &&
    strategyBinding(plan.basis.strategy) &&
    episodeOrder.length > 0 &&
    new Set(episodeOrder.map((item) => item.id)).size === episodeOrder.length &&
    episodeOrder.every((item, index) => item.orderIndex === index) &&
    plan.coverage.length === diagnosis.basis.chapters.length &&
    diagnosis.basis.chapters.every((chapter) =>
      plan.coverage.some(
        (row) =>
          row.chapterId === chapter.id &&
          row.chapterVersion === chapter.version &&
          row.disposition !== "unaccounted",
      ),
    );
  const planTo = tool("season-plan", { seasonPlanId: plan?.id });
  const planWorkflow = workflow("season-plan", (item) => {
    const request = item.input.seasonPlanRequest;
    return Boolean(
      diagnosisReady &&
      request &&
      same(request.diagnosis, diagnosis) &&
      request.diagnosis.strategyId === optionId &&
      strategyBinding(request.strategy) &&
      request.baseAdoptedId === plan?.id,
    );
  });
  const pendingPlan = latest(
    evidence.plans.filter(
      (item) =>
        item.projectId === project.id &&
        item.status === "pending" &&
        item.sourceState === "current" &&
        same(item.basis.authorIntent, intent) &&
        same(item.basis.diagnosis, diagnosis) &&
        item.basis.diagnosis.strategyId === optionId &&
        strategyBinding(item.basis.strategy) &&
        item.basis.baseAdoptedId === plan?.id,
    ),
  )[0];
  addFormal(
    planReady,
    planHeads.length > 1,
    Boolean(plan),
    Boolean(plan && !planReady),
    planReady
      ? `已采用季纲 v${plan!.version} · ${episodeOrder.length} 集`
      : "整季方案尚未就绪",
    plan
      ? `季纲 v${plan.version} · 已用 ${plan.coverage.filter((item) => item.disposition === "used").length}／明确省略 ${plan.coverage.filter((item) => item.disposition === "omitted").length}／未交代 ${plan.coverage.filter((item) => item.disposition === "unaccounted").length} 章；${first ? `当前首集 ${first.id}` : "无有效首集"}。${planReady ? "范围不等于全文理解或质量通过。" : "必须继承当前诊断、策略和意图。"}${issues(plan)}`
      : "季纲须明确采用，并完整交代诊断实际范围；季目录或旧分集树不能代替正式方案。",
    "确认整季分集方案",
    planTo,
    planWorkflow,
    Boolean(diagnosisReady && (!independentPath || strategyReady)),
    pendingPlan
      ? tool("season-plan", { seasonPlanId: pendingPlan.id })
      : undefined,
  );

  const results = evidence.episodes.filter(
    (item) =>
      item.projectId === project.id &&
      item.isCurrent &&
      item.episodeId === first?.id,
  );
  const head = (operation: EpisodeDevelopmentResult["operation"]) => {
    const matches = results.filter((item) => item.operation === operation);
    return {
      value: matches.length === 1 ? matches[0] : undefined,
      ambiguous: matches.length > 1,
    };
  };
  const baseValid = (value?: EpisodeDevelopmentResult) =>
    Boolean(
      planReady &&
      value &&
      value.adoptedAt &&
      value.sourceState === "current" &&
      value.content.kind === value.operation &&
      same(value.basis.request.seasonPlan, plan) &&
      same(value.basis.authorIntent, intent) &&
      same(value.basis.diagnosis, diagnosis) &&
      value.basis.diagnosis?.strategyId === optionId &&
      strategyBinding(value.basis.strategy) &&
      value.basis.request.episodeId === first?.id &&
      value.basis.episode.id === first?.id,
    );
  const outline = head("episode-outline");
  const script = head("episode-script");
  const outlineReady = baseValid(outline.value);
  const scriptReady =
    outlineReady &&
    baseValid(script.value) &&
    same(script.value?.basis.request.outline, outline.value) &&
    Boolean(
      script.value?.scriptId &&
      script.value.episodeRecordId &&
      script.value.scriptDocumentVersion !== undefined,
    );
  const scriptOperation = outlineReady ? "episode-script" : "episode-outline";
  const developmentTo = (
    operation: string,
    params: Record<string, string | undefined> = {},
  ) =>
    tool("episode-development", { episodeId: first?.id, operation, ...params });
  const scriptTo = developmentTo(scriptOperation);
  const scriptWorkflow = episodeWorkflow(scriptOperation);
  addFormal(
    scriptReady,
    outline.ambiguous || script.ambiguous,
    Boolean(script.value),
    Boolean(script.value && !scriptReady),
    scriptReady
      ? `已采用首集剧本 v${script.value!.version}`
      : "首集标准剧本尚未就绪",
    scriptReady
      ? `${first!.id} · 季纲 v${plan!.version} → 大纲 v${outline.value!.version} → 稳定块剧本 v${script.value!.version}；覆盖本集 ${script.value!.basis.chapters.length} 章。文学质量仍须另行评议。`
      : `${script.value ? `剧本历史 v${script.value.version}。` : ""}${first ? `当前首集 ${first.id}。` : "请先采用有效季纲。"}${outlineReady ? "已有正式大纲，下一步生成并采用标准剧本。" : "先采用本集大纲，再开发剧本；其他集、空稿或旧季纲剧本不能替代。"}${issues(script.value)}`,
    outlineReady ? "开发首集标准剧本" : "开发首集大纲",
    scriptTo,
    scriptWorkflow,
    Boolean(planReady),
  );

  const storyboard = head("storyboard-package");
  const storyboardReady =
    scriptReady &&
    baseValid(storyboard.value) &&
    same(storyboard.value?.basis.request.script, script.value) &&
    same(storyboard.value?.basis.request.outline, outline.value) &&
    Boolean(
      storyboard.value?.productionRecords?.some(
        (record) => record.kind === "scenes",
      ) &&
      storyboard.value.productionRecords.some(
        (record) => record.kind === "shots",
      ),
    );
  const packageMatches = evidence.packages.filter(
    (item) =>
      item.manifest.projectId === project.id &&
      item.sourceState === "current" &&
      item.manifest.projectVersion === project.version &&
      item.manifest.episodeId === first?.id &&
      same(item.manifest.adopted.authorIntent, intent) &&
      same(item.manifest.adopted.diagnosis, diagnosis) &&
      item.manifest.adopted.diagnosis?.strategyId === optionId &&
      strategyBinding(item.manifest.adopted.strategy) &&
      same(item.manifest.adopted.seasonPlan, plan) &&
      same(item.manifest.adopted.outline, outline.value) &&
      same(item.manifest.adopted.script, script.value) &&
      same(item.manifest.adopted.storyboard, storyboard.value) &&
      item.manifest.scriptRecordId === script.value?.scriptId &&
      item.manifest.scriptDocumentVersion ===
        script.value?.scriptDocumentVersion,
  );
  const saved = latest(
    packageMatches.filter(
      (item) =>
        item.status === "saved" &&
        item.rights?.confirmed &&
        item.receipt &&
        item.receipt.sha256 === item.archive.sha256 &&
        item.receipt.byteSize === item.archive.byteSize &&
        item.receipt.byteSize > 0 &&
        !item.manifest.preflight.blockers.length &&
        !item.manifest.preflight.checks.some(
          (check) => check.state === "blocked",
        ),
    ),
  )[0];
  const preview = latest(
    packageMatches.filter((item) =>
      ["awaiting-confirmation", "saving", "failed"].includes(item.status),
    ),
  )[0];
  const packageReady = storyboardReady && Boolean(saved);
  const packageTo = developmentTo("storyboard-package", {
    pilotPackageId: (saved ?? preview)?.id,
  });
  if (storyboardReady && !saved && preview) {
    add(
      preview.status === "saving" ? "working" : "needs-human",
      preview.status === "saving" ? "内部试制包正在保存" : "内部试制包等待确认",
      "已有正式分镜，返回实际清单核对阻断项、范围与权利声明；预览、取消和保存失败均不代表交付。未知质量／授权不标通过。",
      "核验并保存内部试制包",
      packageTo,
    );
  } else {
    addFormal(
      packageReady,
      storyboard.ambiguous,
      Boolean(storyboard.value),
      Boolean(storyboard.value && !storyboardReady),
      packageReady
        ? "内部试制包已保存 · 非发行就绪"
        : storyboardReady
          ? "正式分镜已采用，试制包待保存"
          : "首集分镜试制包尚未就绪",
      packageReady
        ? `分镜 v${storyboard.value!.version} · 试制包 v${saved!.version} · ${saved!.receipt!.byteSize} 字节回执／摘要核对。语义质量、授权证明、费用及媒体仍可能未核验；保存不等于发行批准。`
        : `${storyboard.value ? `分镜正式版本 v${storyboard.value.version}。` : ""}分镜必须继承当前首集正式剧本与稳定块，再明确确认并取得 Host 保存回执；不要求先生成静帧、音频或视频。${issues(storyboard.value)}`,
      storyboardReady ? "核验并保存内部试制包" : "开发首集分镜包",
      packageTo,
      episodeWorkflow("storyboard-package"),
      Boolean(scriptReady),
    );
  }
  return finish();

  function workflow(
    operation: CreationWorkflow["input"]["operation"],
    matches: (item: CreationWorkflow) => boolean,
  ) {
    return selectUnresolvedCreationWorkflow(
      evidence!.workflows.filter(
        (item) =>
          item.input.projectId === project.id &&
          item.input.operation === operation &&
          matches(item),
      ),
    );
  }
  function episodeWorkflow(operation: EpisodeDevelopmentResult["operation"]) {
    return workflow(operation, (item) => {
      const request = item.input.episodeDevelopmentRequest;
      return Boolean(
        planReady &&
        request &&
        same(request.seasonPlan, plan) &&
        request.episodeId === first?.id &&
        (operation === "episode-outline" ||
          same(request.outline, outline.value)) &&
        (operation !== "storyboard-package" ||
          same(request.script, script.value)),
      );
    });
  }
  function addFormal(
    ready: unknown,
    ambiguous: boolean,
    exists: boolean,
    stale: boolean,
    label: string,
    detail: string,
    action: string,
    to: string,
    currentWorkflow: CreationWorkflow | undefined,
    upstreamReady: boolean,
    pendingTo?: string,
  ) {
    if (ambiguous)
      return add(
        "unverified",
        "正式采用头不唯一",
        "读取到了冲突的正式版本，不能任选一个显示为完成；请返回原对象核对。",
        action,
        to,
      );
    if (ready) return add("ready", label, detail, action, to);
    if (pendingTo && upstreamReady)
      return add(
        "needs-human",
        "候选等待明确采用",
        `${detail} 候选不是正式成果。`,
        "审阅并采用本阶段候选",
        pendingTo,
      );
    if (currentWorkflow && upstreamReady) {
      const pending = currentWorkflow.stage === "awaiting-review";
      const failed = ["failed", "interrupted"].includes(currentWorkflow.stage);
      const [path, search] = to.split("?");
      const params = new URLSearchParams(search);
      params.set("workflowId", currentWorkflow.id);
      if (currentWorkflow.diagnosisId)
        params.set("diagnosisId", currentWorkflow.diagnosisId);
      if (currentWorkflow.seasonPlanId)
        params.set("seasonPlanId", currentWorkflow.seasonPlanId);
      return add(
        pending ? "needs-human" : failed ? "stale" : "working",
        pending
          ? "候选等待明确采用"
          : failed
            ? "本阶段运行需要处理"
            : "本阶段正在生成与检查",
        `${detail} ${pending ? "候选不是正式成果。" : "不跳过检查或自动采用。"}`,
        pending
          ? "审阅并采用本阶段候选"
          : failed
            ? "处理本阶段失败运行"
            : "查看本阶段运行",
        `${path}?${params}`,
      );
    }
    add(
      stale && exists ? "stale" : "pending",
      stale && exists ? "正式历史版本来源已变化" : label,
      detail,
      action,
      to,
    );
  }
  function finish(): ProjectCockpit {
    const index = gates.findIndex((gate) => gate.status !== "ready");
    const gate = gates[index];
    const status =
      index < 0
        ? "delivered"
        : gate?.status === "working"
          ? "working"
          : gate?.status === "needs-human"
            ? "needs-human"
            : ["stale", "unverified"].includes(gate?.status ?? "")
              ? "needs-attention"
              : "needs-input";
    return {
      status,
      statusLabel:
        index < 0
          ? "内部试制包已保存，发行仍待核验"
          : `${gate!.label} · ${gate!.statusLabel}`,
      primaryAction:
        index < 0
          ? {
              label: "查看内部试制包回执",
              description: gates.at(-1)!.detail,
              to: gates.at(-1)!.to,
            }
          : actions[index]!,
      blockers: index < 0 ? [] : [gate!.detail],
      recentResult:
        [...gates].reverse().find((item) => item.status === "ready")
          ?.statusLabel ?? "尚无当前可核验的正式采用成果。",
      coverage: evidence
        ? [
            { label: "实际来源章", current: evidence.sources.chapters.length },
            {
              label: "当前正式 Gate",
              current: gates.filter((item) => item.status === "ready").length,
              required: gates.length,
            },
          ]
        : [],
      gates,
    };
  }
}
