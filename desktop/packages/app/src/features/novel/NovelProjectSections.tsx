import { NarrativePlanningWorkbench } from "./NarrativePlanningWorkbench";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { StudioClient } from "@dramaip/client";
import type {
  AgentEngineDescriptor,
  AgentEngineKind,
  AgentTaskType,
  ChangePreview,
  Chapter,
  DomainEntity,
  Project,
  Task,
} from "@dramaip/contracts/product";
import { ChangePreviewSchema, TaskSchema } from "@dramaip/contracts/automation";
import {
  BareButton,
  Button,
  Dialog,
  Input,
  Textarea,
  confirmDialog,
  NativeSelect,
} from "@dramaip/ui-shared";
import { AiSettingsLink, useStudioSession } from "../../studio-session";
import { CreativeIntentSummary } from "../../creative-intent";

interface FieldDefinition {
  key: string;
  label: string;
  multiline?: boolean;
  number?: boolean;
  placeholder?: string;
}

const CHARACTER_FIELDS: readonly FieldDefinition[] = [
  { key: "角色定位", label: "角色定位", placeholder: "主角、对手或重要配角" },
  { key: "身份背景", label: "身份背景", multiline: true },
  { key: "性格", label: "性格与行为方式", multiline: true },
  { key: "欲望与目标", label: "欲望与目标", multiline: true },
  { key: "秘密与弱点", label: "秘密与弱点", multiline: true },
  { key: "人物关系", label: "关键人物关系", multiline: true },
  { key: "人物弧光", label: "人物弧光", multiline: true },
  { key: "视觉描述", label: "视觉描述", multiline: true },
];

const OUTLINE_FIELDS: readonly FieldDefinition[] = [
  { key: "大纲层级", label: "大纲层级", placeholder: "全书或章节" },
  { key: "排序", label: "排序", number: true },
  { key: "内容", label: "大纲内容", multiline: true },
];

const ARC_FIELDS: readonly FieldDefinition[] = [
  { key: "层级", label: "规划层级", placeholder: "卷、单元或阶段" },
  { key: "父级故事弧", label: "所属上级" },
  { key: "起始章节", label: "起始章节", number: true },
  { key: "结束章节", label: "结束章节", number: true },
  { key: "核心冲突", label: "核心冲突", multiline: true },
  { key: "高光与伏笔回收", label: "高光与伏笔回收", multiline: true },
];

const LONGFORM_TOOL_CONFIG = {
  memory: {
    label: "章节记忆",
    domain: "chapter-memories",
    title: "章节记忆",
    description:
      "把已完成章节的事件、人物变化、秘密和伏笔沉淀为后续写作可读取的长期记忆。",
    itemName: "章节记忆",
    titleLabel: "记忆名称",
    taskType: "summarize_chapter",
    resultField: "章节摘要",
    fields: [
      { key: "关联章节", label: "关联章节" },
      { key: "章节摘要", label: "章节摘要", multiline: true },
      { key: "重要事件", label: "重要事件", multiline: true },
      { key: "人物变化与秘密", label: "人物变化与秘密", multiline: true },
      { key: "新增或回收伏笔", label: "新增或回收伏笔", multiline: true },
    ],
  },
  states: {
    label: "人物状态",
    domain: "character-states",
    title: "人物状态",
    description:
      "按章节记录角色处境、情绪、关系、能力和秘密变化，避免人物前后矛盾。",
    itemName: "人物状态",
    titleLabel: "状态名称",
    taskType: "update_character_state",
    resultField: "当前状态",
    fields: [
      { key: "关联角色", label: "关联角色" },
      { key: "关联章节", label: "关联章节" },
      { key: "当前状态", label: "当前状态", multiline: true },
      { key: "情绪与关系变化", label: "情绪与关系变化", multiline: true },
      { key: "连续性备注", label: "连续性备注", multiline: true },
    ],
  },
  timeline: {
    label: "时间线",
    domain: "story-events",
    title: "故事时间线",
    description:
      "维护关键事件发生顺序、关联章节和人物，连续写作时会作为事实依据。",
    itemName: "故事事件",
    titleLabel: "事件标题",
    taskType: "extract_story_events",
    resultField: "事件描述",
    fields: [
      { key: "事件类型", label: "事件类型" },
      { key: "关联章节", label: "关联章节" },
      { key: "排序", label: "排序", number: true },
      { key: "事件描述", label: "事件描述", multiline: true },
      { key: "相关角色", label: "相关角色", multiline: true },
    ],
  },
  foreshadowing: {
    label: "伏笔",
    domain: "foreshadowings",
    title: "伏笔管理",
    description:
      "跟踪伏笔的完整生命周期、实际证据、观众认知和逾期状态，不让长篇线索无故消失。",
    itemName: "伏笔",
    titleLabel: "伏笔标题",
    taskType: "extract_foreshadowing",
    resultField: "伏笔说明",
    fields: [
      { key: "埋设章节", label: "埋设章节" },
      { key: "回收章节", label: "回收章节" },
      {
        key: "状态",
        label: "状态",
        placeholder: "埋设、强化、误导、揭示、回收或废弃",
      },
      { key: "计划章节", label: "计划章节" },
      { key: "逾期状态", label: "逾期状态", placeholder: "正常、临近或逾期" },
      {
        key: "观众认知",
        label: "观众认知",
        placeholder: "unknown、suspects、misbelieves 或 knows",
      },
      { key: "伏笔说明", label: "伏笔说明", multiline: true },
      { key: "回收计划", label: "回收计划", multiline: true },
      { key: "实际证据", label: "实际证据", multiline: true },
    ],
  },
  visual: {
    label: "视觉档案",
    domain: "visual-profiles",
    title: "人物视觉档案",
    description:
      "锁定人物外观、服装、发型、色彩和声线，供后续远程图片与视频 API 保持一致。",
    itemName: "视觉档案",
    titleLabel: "档案名称",
    taskType: "generate_character_visual_profile",
    resultField: "外观提示",
    fields: [
      { key: "关联角色", label: "关联角色" },
      { key: "外观提示", label: "外观提示", multiline: true },
      { key: "服装与发型", label: "服装与发型", multiline: true },
      { key: "色彩与气质", label: "色彩与气质", multiline: true },
      { key: "负面提示与声线", label: "负面提示与声线", multiline: true },
    ],
  },
  continuity: {
    label: "一致性",
    domain: "analysis",
    title: "一致性检查",
    description:
      "核对人物、时间线、世界规则、伏笔和章节衔接；报告由你确认后保存。",
    itemName: "一致性报告",
    titleLabel: "检查名称",
    taskType: "check_consistency",
    resultField: "发现",
    fields: [
      { key: "分析类型", label: "分析类型", placeholder: "一致性检查" },
      { key: "关联章节", label: "检查范围" },
      { key: "评分", label: "评分", number: true },
      { key: "发现", label: "发现", multiline: true },
      { key: "建议", label: "修正建议", multiline: true },
    ],
  },
  analysis: {
    label: "创作分析",
    domain: "analysis",
    title: "创作分析",
    description:
      "分析文本质量、原创性风险、节拍、爽点、钩子和短剧适配，不自动修改正文。",
    itemName: "分析报告",
    titleLabel: "分析名称",
    taskType: "analyze_text_quality",
    resultField: "发现",
    fields: [
      { key: "分析类型", label: "分析类型" },
      { key: "关联章节", label: "分析范围" },
      { key: "评分", label: "评分", number: true },
      { key: "发现", label: "分析发现", multiline: true },
      { key: "建议", label: "优化建议", multiline: true },
    ],
  },
  room: {
    label: "编剧室",
    domain: "analysis",
    title: "编剧室",
    description:
      "让单个所选模型分别扮演主编、人物、冲突喜剧、世界逻辑、受众和视觉制作编辑，输出分歧矩阵与可选择建议。",
    itemName: "编剧室纪要",
    titleLabel: "纪要名称",
    taskType: "writing_room_review",
    resultField: "发现",
    fields: [
      { key: "分析类型", label: "会议类型", placeholder: "编剧室审稿" },
      { key: "关联章节", label: "讨论范围" },
      { key: "发现", label: "讨论纪要", multiline: true },
      { key: "建议", label: "行动清单", multiline: true },
    ],
  },
} as const satisfies Record<
  string,
  {
    label: string;
    domain: string;
    title: string;
    description: string;
    itemName: string;
    titleLabel: string;
    taskType: AgentTaskType;
    resultField: string;
    fields: readonly FieldDefinition[];
  }
>;

const FIELD_LABELS: Record<string, string> = {
  title: "项目名称",
  targetAudience: "目标读者",
  targetWordCount: "目标字数",
  targetEpisodeCount: "目标集数",
  coreHook: "核心钩子",
  emotionalCore: "情绪主轴",
  coreSellingPoint: "核心卖点",
  synopsis: "故事梗概",
  styleGuide: "创作规范",
  visualStyleDirection: "视觉风格方向",
  genreOpportunity: "题材机会",
  productionBrief: "制作说明",
};

function payloadRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function targetPreview(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { 内容: String(value ?? "") };
}

function previewFromTaskResult(value: unknown): ChangePreview | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const candidate = (value as Record<string, unknown>).changePreview;
  return candidate && typeof candidate === "object" && !Array.isArray(candidate)
    ? (candidate as ChangePreview)
    : undefined;
}

function displayValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(displayValue).join("、");
  if (value && typeof value === "object")
    return Object.entries(value as Record<string, unknown>)
      .map(
        ([key, nested]) =>
          `${FIELD_LABELS[key] ?? key}：${displayValue(nested)}`,
      )
      .join("\n");
  return value === undefined || value === null ? "" : String(value);
}

export function NovelCharactersSection(props: {
  client: StudioClient;
  projectId: string;
  defaultInstruction?: string;
}) {
  return (
    <NovelResourceSection
      {...props}
      domain="characters"
      title="人物"
      description="先建立主要人物，再开始全书大纲和连续章节生成。人物动机、秘密、关系与弧光都会进入智能写作上下文。"
      itemName="人物"
      titleLabel="角色姓名"
      fields={CHARACTER_FIELDS}
      generator={{
        taskType: "generate_characters",
        title: "智能生成人物卡",
        description:
          "根据项目设定一次生成主要人物，检查后以完整人物方案包审阅采用。",
        defaultInstruction: props.defaultInstruction,
      }}
    />
  );
}

export type NovelOutlineMode = "book" | "chapter" | "arc";

export function NovelOutlineSection(props: {
  client: StudioClient;
  projectId: string;
  mode?: NovelOutlineMode;
  onModeChange?(mode: NovelOutlineMode): void;
  defaultInstruction?: string;
}) {
  const [internalMode, setInternalMode] = useState<NovelOutlineMode>("book");
  const mode = props.mode ?? internalMode;
  const setMode = (value: NovelOutlineMode) => {
    if (props.mode === undefined) setInternalMode(value);
    props.onModeChange?.(value);
  };
  const configuration =
    mode === "arc"
      ? {
          domain: "story-arcs",
          title: "卷与单元规划",
          description:
            "用卷、单元和阶段管理长篇推进、章节范围、冲突升级和伏笔回收。",
          itemName: "规划",
          titleLabel: "规划标题",
          fields: ARC_FIELDS,
          taskType: "generate_story_arc_outline" as const,
          generatorTitle: "智能规划卷与单元",
        }
      : mode === "chapter"
        ? {
            domain: "outlines",
            title: "章节大纲",
            description:
              "AI 根据题材与全书规划提出章节任务、人物目标、节奏和事实约束。",
            itemName: "章节大纲",
            titleLabel: "章节大纲标题",
            fields: OUTLINE_FIELDS,
            taskType: "generate_chapter_outline" as const,
            generatorTitle: "智能拆分章节大纲",
          }
        : {
            domain: "outlines",
            title: "全书大纲",
            description:
              "整理主线走向、阶段冲突、关键爽点与高潮，作为连续生成章节的结构依据。",
            itemName: "大纲",
            titleLabel: "大纲标题",
            fields: OUTLINE_FIELDS,
            taskType: "generate_book_outline" as const,
            generatorTitle: "智能生成全书大纲",
          };
  return (
    <div className="space-y-4">
      <nav className="inline-flex rounded-lg border border-line bg-surface-muted p-1 text-sm shadow-control">
        {(
          [
            ["book", "全书大纲"],
            ["chapter", "章节大纲"],
            ["arc", "卷与单元"],
          ] as const
        ).map(([value, label]) => (
          <BareButton
            key={value}
            className={`rounded-full px-4 py-2 ${mode === value ? "bg-surface-raised font-medium text-rust shadow-card" : "text-muted hover:text-ink"}`}
            onClick={() => setMode(value)}
          >
            {label}
          </BareButton>
        ))}
      </nav>
      <NovelResourceSection
        key={mode}
        client={props.client}
        projectId={props.projectId}
        domain={configuration.domain}
        title={configuration.title}
        description={configuration.description}
        itemName={configuration.itemName}
        titleLabel={configuration.titleLabel}
        fields={configuration.fields}
        filter={(item) => {
          if (mode === "arc") return true;
          const level = String(payloadRecord(item.payload)["大纲层级"] ?? "");
          return mode === "book"
            ? level === "全书" || !level
            : level === "章节";
        }}
        generator={{
          taskType: configuration.taskType,
          title: configuration.generatorTitle,
          description: "AI 提出完整规划并检查一致性，审阅采用后进入正式资料。",
          defaultInstruction: props.defaultInstruction,
        }}
      />
    </div>
  );
}

export function NovelLongformToolsSection(props: {
  client: StudioClient;
  projectId: string;
  chapters: Chapter[];
}) {
  type ToolKey = keyof typeof LONGFORM_TOOL_CONFIG;
  const [tool, setTool] = useState<ToolKey>("memory");
  const [refreshKey, setRefreshKey] = useState(0);
  const configuration = LONGFORM_TOOL_CONFIG[tool];
  return (
    <div className="space-y-4">
      <section className="studio-card p-6">
        <h2 className="text-xl font-semibold">更多创作工具</h2>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-muted">
          旧版的长篇记忆、人物状态、时间线、伏笔、一致性、创作分析和编剧室全部保留，但按使用目的分组，不再挤进章节编辑器。
        </p>
        <nav className="mt-4 flex flex-wrap gap-2" aria-label="长篇创作工具">
          {(
            Object.entries(LONGFORM_TOOL_CONFIG) as Array<
              [ToolKey, (typeof LONGFORM_TOOL_CONFIG)[ToolKey]]
            >
          ).map(([value, item]) => (
            <BareButton
              key={value}
              className={`rounded-full px-4 py-2 text-sm ${tool === value ? "bg-studio-dark text-white shadow-card" : "border border-line bg-surface-raised text-muted hover:border-line-strong hover:text-ink"}`}
              onClick={() => setTool(value)}
            >
              {item.label}
            </BareButton>
          ))}
        </nav>
      </section>
      <NovelInsightRunner
        key={`runner:${tool}`}
        client={props.client}
        projectId={props.projectId}
        taskType={configuration.taskType}
        title={`智能${configuration.title}`}
        description={`${configuration.description} 生成结果只作为候选，点击“保存到项目”后才会进入正式资料。`}
        domain={configuration.domain}
        itemName={configuration.itemName}
        resultField={configuration.resultField}
        chapters={props.chapters}
        onSaved={() => setRefreshKey((value) => value + 1)}
      />
      <NovelResourceSection
        key={`${tool}:${refreshKey}`}
        client={props.client}
        projectId={props.projectId}
        domain={configuration.domain}
        title={configuration.title}
        description={configuration.description}
        itemName={configuration.itemName}
        titleLabel={configuration.titleLabel}
        fields={configuration.fields}
        filter={(item) => {
          if (configuration.domain !== "analysis") return true;
          const type = String(payloadRecord(item.payload)["分析类型"] ?? "");
          if (tool === "continuity") return type.includes("一致性");
          if (tool === "room") return type.includes("编剧室");
          return !type.includes("一致性") && !type.includes("编剧室");
        }}
      />
    </div>
  );
}

function NovelResourceSection(props: {
  client: StudioClient;
  projectId: string;
  domain: string;
  title: string;
  description: string;
  itemName: string;
  titleLabel: string;
  fields: readonly FieldDefinition[];
  filter?(item: DomainEntity): boolean;
  generator?: {
    taskType: AgentTaskType;
    title: string;
    description: string;
    defaultInstruction?: string;
  };
}) {
  const [items, setItems] = useState<DomainEntity[]>([]);
  const [editor, setEditor] = useState<DomainEntity | "new">();
  const [title, setTitle] = useState("");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string>();
  const [saving, setSaving] = useState(false);
  const load = () =>
    props.client.resources
      .list(props.domain, props.projectId)
      .then(setItems)
      .catch((cause) =>
        setNotice(cause instanceof Error ? cause.message : String(cause)),
      );
  useEffect(() => void load(), [props.client, props.domain, props.projectId]);
  const visibleItems = props.filter ? items.filter(props.filter) : items;
  const open = (value: DomainEntity | "new") => {
    const payload = value === "new" ? {} : payloadRecord(value.payload);
    setEditor(value);
    setTitle(value === "new" ? "" : value.title);
    setDraft(
      Object.fromEntries(
        props.fields.map((field) => [
          field.key,
          String(payload[field.key] ?? ""),
        ]),
      ),
    );
    setNotice(undefined);
  };
  const save = async () => {
    if (!editor || !title.trim()) return;
    setSaving(true);
    try {
      const payload = Object.fromEntries(
        props.fields.map((field) => [
          field.key,
          field.number && draft[field.key]
            ? Number(draft[field.key])
            : (draft[field.key] ?? ""),
        ]),
      );
      if (editor === "new")
        await props.client.resources.create(props.domain, {
          projectId: props.projectId,
          title: title.trim(),
          payload,
        });
      else
        await props.client.resources.update(props.domain, editor.id, {
          title: title.trim(),
          payload: { ...payloadRecord(editor.payload), ...payload },
          version: editor.version,
        });
      setEditor(undefined);
      setNotice(`${props.itemName}已保存。`);
      await load();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };
  const remove = async (item: DomainEntity) => {
    if (!(await confirmDialog(`确定删除“${item.title}”吗？`))) return;
    try {
      await props.client.resources.remove(props.domain, item.id);
      await load();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return (
    <section className="studio-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h2 className="text-xl font-semibold">{props.title}</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            {props.description}
          </p>
        </div>
        <BareButton
          className="rounded-full bg-studio-dark px-5 py-2.5 text-sm font-medium text-white shadow-card hover:bg-rust"
          onClick={() => open("new")}
        >
          补充已有{props.itemName}
        </BareButton>
      </div>
      {props.generator && (
        <>
          <NarrativePlanningWorkbench
            projectId={props.projectId}
            operation={
              props.generator.taskType === "generate_characters"
                ? "characters"
                : props.generator.taskType === "generate_story_arc_outline"
                  ? "story-arc"
                  : props.generator.taskType === "generate_chapter_outline"
                    ? "chapter-outline"
                    : "book-outline"
            }
            defaultInstruction={props.generator.defaultInstruction}
            onApplied={load}
          />
          <details className="mt-4 text-sm text-muted">
            <summary className="cursor-pointer">旧方案与生成记录</summary>
            <NovelArtifactGenerator
              client={props.client}
              projectId={props.projectId}
              {...props.generator}
              onCommitted={load}
            />
          </details>
        </>
      )}
      {notice && (
        <p className="mt-4 rounded-lg bg-brand-soft p-3 text-sm text-brand">
          {notice}
        </p>
      )}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {visibleItems.map((item) => {
          const payload = payloadRecord(item.payload);
          return (
            <article
              key={item.id}
              className="rounded-xl border border-line bg-surface-raised p-5 shadow-card transition hover:border-line-strong"
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold">{item.title}</h3>
                  <dl className="mt-3 space-y-2">
                    {props.fields
                      .filter((field) =>
                        String(payload[field.key] ?? "").trim(),
                      )
                      .slice(0, 4)
                      .map((field) => (
                        <div key={field.key}>
                          <dt className="text-xs font-medium text-muted">
                            {field.label}
                          </dt>
                          <dd className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-sm leading-6">
                            {String(payload[field.key])}
                          </dd>
                        </div>
                      ))}
                  </dl>
                </div>
                <div className="flex shrink-0 flex-col gap-2 text-xs">
                  <BareButton className="text-brand" onClick={() => open(item)}>
                    编辑
                  </BareButton>
                  <BareButton
                    className="text-danger-strong"
                    onClick={() => void remove(item)}
                  >
                    删除
                  </BareButton>
                </div>
              </div>
            </article>
          );
        })}
        {!visibleItems.length && (
          <p className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-muted lg:col-span-2">
            还没有{props.itemName}。提出创作目标，AI 会生成可审阅的完整方案。
          </p>
        )}
      </div>
      {editor && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setEditor(undefined);
          }}
        >
          <Dialog.Content
            className="max-w-2xl"
            aria-label={`${props.itemName}编辑窗口`}
          >
            <div>
              <Dialog.Title>
                {editor === "new"
                  ? `新建${props.itemName}`
                  : `编辑${props.itemName}`}
              </Dialog.Title>
            </div>
            <label className="mt-5 grid gap-1 text-sm">
              {props.titleLabel}
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <div className="mt-4 grid gap-4">
              {props.fields.map((field) => (
                <label key={field.key} className="grid gap-1 text-sm">
                  {field.label}
                  {field.multiline ? (
                    <Textarea
                      className="min-h-24"
                      value={draft[field.key] ?? ""}
                      placeholder={field.placeholder}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          [field.key]: event.target.value,
                        }))
                      }
                    />
                  ) : (
                    <Input
                      type={field.number ? "number" : "text"}
                      value={draft[field.key] ?? ""}
                      placeholder={field.placeholder}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          [field.key]: event.target.value,
                        }))
                      }
                    />
                  )}
                </label>
              ))}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEditor(undefined)}>
                取消
              </Button>
              <Button
                variant="primary"
                disabled={saving || !title.trim()}
                onClick={() => void save()}
              >
                {saving ? "正在保存…" : "保存"}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog>
      )}
    </section>
  );
}

function agentResultText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  if (Array.isArray(value))
    return value.map(agentResultText).filter(Boolean).join("\n\n");
  if (typeof value !== "object") return String(value);
  const record = value as Record<string, unknown>;
  for (const key of ["content", "output", "summary", "text", "message"]) {
    const text = agentResultText(record[key]);
    if (text.trim()) return text;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function NovelInsightRunner(props: {
  client: StudioClient;
  projectId: string;
  taskType: AgentTaskType;
  title: string;
  description: string;
  domain: string;
  itemName: string;
  resultField: string;
  chapters: Chapter[];
  onSaved(): void;
}) {
  const [instruction, setInstruction] = useState("");
  const [engineKind, setEngineKind] = useState<AgentEngineKind>("pi");
  const [engines, setEngines] = useState<AgentEngineDescriptor[]>([]);
  const [taskId, setTaskId] = useState<string>();
  const [runId, setRunId] = useState<string>();
  const [chapterId, setChapterId] = useState("");
  const [output, setOutput] = useState("");
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const taskRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    void Promise.all([
      props.client.agentEngines.list(),
      props.client.agentEngines.getProjectSettings(props.projectId),
    ]).then(([items, settings]) => {
      setEngines(items);
      setEngineKind(settings.defaultEngineKind);
    });
  }, [props.client, props.projectId]);
  useEffect(
    () =>
      props.client.events.subscribe((event) => {
        if (
          event.type !== "task.updated" ||
          !event.payload ||
          typeof event.payload !== "object"
        )
          return;
        const parsed = TaskSchema.safeParse(event.payload);
        if (!parsed.success) return;
        const task = parsed.data;
        if (task.id !== taskRef.current) return;
        if (task.status === "failed") {
          setBusy(false);
          setNotice(task.error ?? "智能分析未能完成，请使用原引擎重试");
          return;
        }
        if (task.status === "canceled" || task.status === "interrupted") {
          setBusy(false);
          setNotice(
            task.status === "canceled" ? "本次分析已取消" : "本次分析已中断",
          );
          return;
        }
        if (task.status !== "succeeded") return;
        const text = agentResultText(task.result);
        setBusy(false);
        setOutput(text);
        setNotice(
          text.trim()
            ? "候选结果已经生成；核对后可以保存到项目。"
            : "模型本次没有返回内容，可使用相同设置重试。",
        );
      }),
    [props.client],
  );
  const selectedEngine = engines.find((engine) => engine.kind === engineKind);
  const canRun = selectedEngine
    ? (selectedEngine.canRun ?? selectedEngine.status === "available")
    : false;
  const run = async () => {
    if (!canRun) {
      setNotice(
        selectedEngine?.statusMessage ?? "所选智能引擎当前不能执行此任务",
      );
      return;
    }
    setBusy(true);
    setOutput("");
    setNotice("正在读取项目、章节和长篇资料…");
    try {
      const session = await props.client.agentSessions.create({
        projectId: props.projectId,
        ...(chapterId ? { chapterId } : {}),
        engineKind,
        taskType: props.taskType,
        title: props.title,
      });
      const started = await props.client.agentSessions.run(
        session.id,
        {
          taskType: props.taskType,
          ...(instruction.trim() ? { prompt: instruction.trim() } : {}),
        },
        crypto.randomUUID(),
      );
      taskRef.current = started.taskId;
      setTaskId(started.taskId);
      setRunId(started.runId);
    } catch (cause) {
      setBusy(false);
      setNotice(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const save = async () => {
    if (!output.trim()) return;
    setBusy(true);
    try {
      const now = new Date();
      await props.client.resources.create(props.domain, {
        projectId: props.projectId,
        ...(chapterId ? { parentId: chapterId } : {}),
        title: `${props.itemName} · ${now.toLocaleString("zh-CN")}`,
        payload: {
          [props.resultField]: output,
          ...(props.domain === "analysis"
            ? {
                分析类型:
                  props.taskType === "check_consistency"
                    ? "一致性检查"
                    : props.taskType.startsWith("writing_room")
                      ? "编剧室审稿"
                      : "创作分析",
              }
            : {}),
          来源: `${selectedEngine?.name ?? engineKind} · ${props.title}`,
          任务标识: taskId ?? "",
        },
      });
      setNotice("结果已保存到项目资料。后续智能写作会按上下文策略读取。 ");
      props.onSaved();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="rounded-xl border border-line bg-brand-soft/55 p-6 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h2 className="font-semibold">{props.title}</h2>
          <p className="mt-1 text-sm leading-6 text-muted">
            {props.description}
          </p>
        </div>
        <label className="grid gap-1 text-xs text-muted">
          本次使用的智能引擎
          <NativeSelect
            className="w-auto text-sm"
            value={engineKind}
            disabled={busy}
            onChange={(event) =>
              setEngineKind(event.target.value as AgentEngineKind)
            }
          >
            {engines.map((engine) => (
              <option
                key={engine.kind}
                value={engine.kind}
                disabled={engine.canRun === false}
              >
                {engine.name}
                {engine.canRun === false ? " · 不可运行" : ""}
              </option>
            ))}
          </NativeSelect>
        </label>
      </div>
      <textarea
        className="mt-4 min-h-20 w-full rounded-xl border border-line bg-surface-raised p-3 text-sm"
        value={instruction}
        disabled={busy}
        aria-label="补充分析要求（可选）"
        placeholder="例如：重点检查第 1–10 章的人物动机和时间线。"
        onChange={(event) => setInstruction(event.target.value)}
      />
      {props.taskType === "writing_room_review" && (
        <p className="mt-2 rounded-lg border border-line bg-surface-raised px-3 py-2 text-xs leading-5 text-muted">
          默认执行：当前所选模型 1 次结构化调用，模拟 6 个隔离角色并由主编整合；
          实际 Token
          与费用在运行记录中展示。三引擎盲测不会自动开启，需在实验入口单独确认。
        </p>
      )}
      <label className="mt-3 grid max-w-md gap-1 text-xs text-muted">
        分析范围
        <NativeSelect
          className="w-auto text-sm"
          value={chapterId}
          disabled={busy}
          onChange={(event) => setChapterId(event.target.value)}
        >
          <option value="">整个项目</option>
          {props.chapters.map((chapter) => (
            <option key={chapter.id} value={chapter.id}>
              {chapter.title}
            </option>
          ))}
        </NativeSelect>
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <BareButton
          className="rounded-full bg-studio-dark px-5 py-2.5 text-sm font-medium text-white shadow-card hover:bg-rust disabled:opacity-40"
          disabled={busy || !canRun}
          onClick={() => void run()}
        >
          {busy ? "正在处理…" : "开始智能分析"}
        </BareButton>
        {busy && runId && (
          <BareButton
            className="rounded-lg border border-line bg-surface-raised px-4 py-2 text-sm text-muted"
            onClick={() => void props.client.agentSessions.interrupt(runId)}
          >
            中断本次任务
          </BareButton>
        )}
        {output.trim() && (
          <BareButton
            className="rounded-lg border border-brand bg-surface-raised px-4 py-2 text-sm font-medium text-brand"
            disabled={busy}
            onClick={() => void save()}
          >
            保存到项目
          </BareButton>
        )}
      </div>
      {notice && <p className="mt-3 text-sm text-brand">{notice}</p>}
      {output.trim() && (
        <div className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-surface-raised p-4 text-sm leading-7">
          {output}
        </div>
      )}
    </section>
  );
}

export function NovelArtifactGenerator(props: {
  client: StudioClient;
  projectId: string;
  taskType: AgentTaskType;
  title: string;
  description: string;
  defaultInstruction?: string;
  onCommitted(): void | Promise<void>;
}) {
  const studioSession = useStudioSession();
  const actionId = `novel-artifact:${props.taskType}`;
  const returnedFromSettings =
    studioSession.pendingIntent?.actionId === actionId;
  const [expanded, setExpanded] = useState(returnedFromSettings);
  const [instruction, setInstruction] = useState(
    () =>
      (studioSession.pendingIntent?.actionId === actionId
        ? studioSession.pendingIntent.input
        : undefined) ??
      props.defaultInstruction ??
      "",
  );
  const [engines, setEngines] = useState<AgentEngineDescriptor[]>([]);
  const [engineKind, setEngineKind] = useState<AgentEngineKind>("pi");
  const [task, setTask] = useState<Task>();
  const [runId, setRunId] = useState<string>();
  const [preview, setPreview] = useState<ChangePreview>();
  const [intentProject, setIntentProject] = useState<Project>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const taskRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    void Promise.all([
      props.client.agentEngines.list(),
      props.client.agentEngines.getProjectSettings(props.projectId),
      props.client.projects.get(props.projectId),
    ]).then(([items, settings, project]) => {
      setEngines(items);
      setEngineKind(settings.defaultEngineKind);
      setIntentProject(project);
    });
  }, [props.client, props.projectId]);
  useEffect(
    () =>
      props.client.events.subscribe((event) => {
        if (!event.payload || typeof event.payload !== "object") return;
        const parsed = TaskSchema.safeParse(event.payload);
        if (
          event.type === "task.updated" &&
          parsed.success &&
          parsed.data.id === taskRef.current
        ) {
          const value = parsed.data;
          setTask(value);
          if (value.status === "failed") {
            setBusy(false);
            setNotice(value.error ?? "智能生成未能完成，请使用原引擎重试");
          } else if (value.status === "succeeded") {
            const generatedPreview = previewFromTaskResult(value.result);
            if (generatedPreview) {
              setPreview(generatedPreview);
              setBusy(false);
              setNotice("智能方案已生成，请核对后采用。");
            } else {
              setBusy(false);
              setNotice("模型没有返回可采用的结构化方案，请使用相同设置重试。");
            }
          }
        }
        if (event.type === "change_preview.created") {
          const preview = ChangePreviewSchema.safeParse(event.payload);
          if (!preview.success) return;
          const value = preview.data;
          if (value.taskId !== taskRef.current) return;
          void props.client.changePreviews.get(value.id).then((current) => {
            setPreview(current);
            setBusy(false);
            setNotice("智能方案已生成，请核对后采用。");
          });
        }
      }),
    [props.client],
  );
  const selectedEngine = engines.find((item) => item.kind === engineKind);
  const canRun = selectedEngine
    ? (selectedEngine.canRun ?? selectedEngine.status === "available")
    : false;
  const run = async () => {
    if (!canRun) {
      setNotice(selectedEngine?.statusMessage ?? "所选智能引擎当前不能运行");
      return;
    }
    if (returnedFromSettings) studioSession.clearPendingIntent();
    setBusy(true);
    setPreview(undefined);
    setNotice(undefined);
    try {
      const session = await props.client.agentSessions.create({
        projectId: props.projectId,
        engineKind,
        taskType: props.taskType,
        title: props.title,
      });
      const started = await props.client.agentSessions.run(
        session.id,
        {
          taskType: props.taskType,
          ...(instruction.trim() ? { prompt: instruction.trim() } : {}),
        },
        crypto.randomUUID(),
      );
      taskRef.current = started.taskId;
      setRunId(started.runId);
      setTask({
        id: started.taskId,
        kind: `agent.${props.taskType}`,
        status: "queued",
        attentionStatus: "open",
        resultStatus: "none",
        title: props.title,
        progress: 0,
        projectId: props.projectId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      setNotice("正在读取项目上下文并生成方案…");
    } catch (cause) {
      setBusy(false);
      setNotice(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const commit = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      await props.client.changePreviews.commit(preview.id, crypto.randomUUID());
      setPreview(undefined);
      setNotice("智能方案已经采用。");
      await props.onCommitted();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const discard = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      await props.client.changePreviews.discard(
        preview.id,
        crypto.randomUUID(),
      );
      setPreview(undefined);
      setNotice("已放弃这次智能方案。");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-5 rounded-xl border border-line bg-brand-soft/45 p-5 shadow-card">
      <BareButton
        className="flex w-full items-start gap-3 text-left"
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-ink">{props.title}</span>
          <span className="mt-1 block text-sm text-muted">
            {props.description}
          </span>
        </span>
        <span className="text-sm text-brand">{expanded ? "收起" : "开始"}</span>
      </BareButton>
      {expanded && (
        <div className="mt-4 space-y-3">
          <textarea
            className="min-h-20 w-full rounded-lg border border-line bg-surface-raised p-3 text-sm"
            value={instruction}
            disabled={busy}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder="补充你的想法或要求；留空也可以直接生成。"
          />
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid min-w-48 flex-1 gap-1 text-xs text-muted">
              本次使用的智能引擎
              <NativeSelect
                className="w-auto text-sm"
                value={engineKind}
                disabled={busy}
                onChange={(event) =>
                  setEngineKind(event.target.value as AgentEngineKind)
                }
              >
                {engines.map((engine) => (
                  <option
                    key={engine.kind}
                    value={engine.kind}
                    disabled={engine.canRun === false}
                  >
                    {engine.name} ·{" "}
                    {engine.canRun === false ? "不可运行" : "可运行"}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <BareButton
              className={`rounded-full bg-studio-dark px-5 py-2.5 text-sm font-medium text-white shadow-card hover:bg-rust disabled:opacity-50 ${returnedFromSettings ? "ring-2 ring-brand ring-offset-2" : ""}`}
              disabled={busy || !canRun}
              onClick={() => void run()}
            >
              {busy
                ? "正在生成…"
                : returnedFromSettings
                  ? "配置已完成，确认继续"
                  : "立即生成"}
            </BareButton>
          </div>
          {!canRun && (
            <p className="text-sm text-warning-strong">
              {selectedEngine?.statusMessage ?? "请先完成模型服务商配置。"}{" "}
              <AiSettingsLink
                actionId={actionId}
                projectId={props.projectId}
                input={instruction}
                returnTo={`/projects/${encodeURIComponent(props.projectId)}?section=settings`}
                className="underline"
              >
                前往设置
              </AiSettingsLink>
            </p>
          )}
          {task && (
            <div className="rounded-lg bg-surface-raised p-3 text-sm">
              <div className="flex justify-between gap-2">
                <span>{task.title}</span>
                <span className="text-muted">
                  {task.status === "queued"
                    ? "等待中"
                    : task.status === "running"
                      ? "生成中"
                      : task.status === "succeeded"
                        ? "已完成"
                        : task.status === "failed"
                          ? "失败"
                          : "已中断"}
                </span>
              </div>
              <div className="mt-2 h-1.5 rounded-md bg-surface-muted">
                <div
                  className="h-full rounded-md bg-brand"
                  style={{ width: `${Math.max(3, task.progress * 100)}%` }}
                />
              </div>
              {runId && (
                <Link
                  className="mt-2 inline-block text-xs text-link underline"
                  to="/tasks"
                >
                  查看完整过程
                </Link>
              )}
            </div>
          )}
          {notice && <p className="text-sm leading-6 text-muted">{notice}</p>}
          {preview && (
            <section className="rounded-xl border border-line-strong bg-surface-raised p-5 shadow-card">
              <h3 className="font-medium">待采用内容</h3>
              <p className="mt-1 text-xs text-muted">
                共 {preview.targets.length}{" "}
                项，采用后一次性写入；内容变化时会阻止覆盖。
              </p>
              {intentProject && (
                <div className="mt-3">
                  <CreativeIntentSummary
                    project={intentProject}
                    preview={preview}
                    compact
                  />
                </div>
              )}
              <div className="mt-3 max-h-80 space-y-2 overflow-auto">
                {preview.targets.map((target, index) => {
                  const value = targetPreview(
                    target.displayDiff ?? target.patch,
                  );
                  return (
                    <article
                      key={`${target.id}-${index}`}
                      className="rounded-lg bg-surface-muted p-3"
                    >
                      <p className="text-sm font-medium">
                        {displayValue(
                          value.title ?? value.name ?? `候选 ${index + 1}`,
                        )}
                      </p>
                      <dl className="mt-2 space-y-1">
                        {Object.entries(value)
                          .filter(([key]) => !["title", "name"].includes(key))
                          .map(([key, nested]) => (
                            <div
                              key={key}
                              className="grid gap-1 text-xs sm:grid-cols-[110px_1fr]"
                            >
                              <dt className="font-medium text-muted">
                                {FIELD_LABELS[key] ?? key}
                              </dt>
                              <dd className="whitespace-pre-wrap leading-5">
                                {displayValue(nested)}
                              </dd>
                            </div>
                          ))}
                      </dl>
                    </article>
                  );
                })}
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <BareButton
                  className="rounded-lg border border-line px-3 py-2 text-sm"
                  disabled={busy}
                  onClick={() => void discard()}
                >
                  放弃
                </BareButton>
                <BareButton
                  className="rounded-full bg-studio-dark px-5 py-2.5 text-sm font-medium text-white shadow-card hover:bg-rust disabled:opacity-50"
                  disabled={busy}
                  onClick={() => void commit()}
                >
                  确认采用
                </BareButton>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
