import { NarrativePlanningWorkbench } from "./NarrativePlanningWorkbench";
import { useEffect, useState } from "react";
import type { StudioClient } from "../../../facade/index";
import type {
  AgentItem,
  AgentTaskType,
  Chapter,
  DomainEntity,
} from "@dramaip/contracts/product";
import {
  BareButton,
  Button,
  Dialog,
  Input,
  Textarea,
  NativeSelect,
} from "@dramaip/infra-ui-primitives";
import { confirmDialog } from "../../controls";
import { AiSettingsLink, useStudioSession } from "../../studio-session";
import { useNavigate, useSearchParams } from "../../router";
import {
  openingFixInstruction,
  parseOpeningIssues,
  type OpeningIssue,
} from "./opening-check";
import styles from "./NovelProjectSections.module.css";
import { copyText } from "../../copy";
import { clsx } from "clsx";

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
    prompt:
      "检查已写章节里人物、时间线、世界规则、伏笔和章节衔接有没有前后矛盾。逐条列出问题，每条写明出现在哪一章、原文怎么写、和哪里冲突、建议怎么改。没有问题就直接说没有发现矛盾。",
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
    prompt:
      "分析已写章节的文字质量、节奏、爽点、钩子和改编成短剧的潜力。先给一句总体评价，再逐条列出最值得改的地方，每条写明原文片段和具体修改建议。",
    fields: [
      { key: "分析类型", label: "分析类型" },
      { key: "关联章节", label: "分析范围" },
      { key: "评分", label: "评分", number: true },
      { key: "发现", label: "分析发现", multiline: true },
      { key: "建议", label: "优化建议", multiline: true },
    ],
  },
  opening: {
    label: "开篇检查",
    domain: "analysis",
    title: "开篇检查",
    description:
      "按网文「黄金三章」标准检查前三章：开场抓不抓人、主角目标是否清楚、章末钩子、拖沓段落和付费卡点。",
    itemName: "开篇检查报告",
    titleLabel: "检查名称",
    taskType: "review_opening",
    resultField: "发现",
    prompt: "检查这部小说的第 1 到第 3 章（选了具体章节时只检查那一章）。",
    fields: [
      { key: "分析类型", label: "分析类型", placeholder: "开篇检查" },
      { key: "关联章节", label: "检查范围" },
      { key: "发现", label: "发现", multiline: true },
      { key: "建议", label: "修改建议", multiline: true },
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
    prompt:
      "以主编、人物、冲突、世界逻辑、读者和视觉制作六个角度审读已写章节，列出各方意见和分歧，最后由主编整理成可执行的修改清单。",
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
    prompt: string;
    fields: readonly FieldDefinition[];
  }
>;

/**
 * What AI keeps on its own as chapters are written: read here, never typed
 * in by hand. Each entry lists the fields worth showing, in order.
 */
const STORY_MEMORY_VIEWS = [
  {
    domain: "chapter-memories",
    label: "章节摘要",
    fields: [
      ["关联章节", "章节"],
      ["章节摘要", "摘要"],
      ["重要事件", "重要事件"],
      ["人物变化与秘密", "人物变化"],
      ["新增或回收伏笔", "伏笔"],
    ],
  },
  {
    domain: "character-states",
    label: "人物现状",
    fields: [
      ["关联角色", "人物"],
      ["关联章节", "截至章节"],
      ["当前状态", "现状"],
      ["情绪与关系变化", "关系变化"],
    ],
  },
  {
    domain: "story-events",
    label: "时间线",
    fields: [
      ["关联章节", "章节"],
      ["事件描述", "发生了什么"],
      ["相关角色", "相关人物"],
    ],
  },
  {
    domain: "foreshadowings",
    label: "伏笔",
    fields: [
      ["状态", "状态"],
      ["埋设章节", "埋在"],
      ["计划章节", "计划回收"],
      ["伏笔说明", "说明"],
    ],
  },
] as const;

function payloadRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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
      title={copyText("app/features/novel/NovelProjectSections.1")}
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
    <div className={styles.c1}>
      <nav className={styles.c2}>
        {(
          [
            ["book", "全书大纲"],
            ["chapter", "章节大纲"],
            ["arc", "卷与单元"],
          ] as const
        ).map(([value, label]) => (
          <BareButton
            key={value}
            className={clsx(styles.c3, mode === value ? styles.k1 : styles.k2)}
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
  // A chapter's 开篇检查 link opens this tab on that tool and chapter.
  const [search] = useSearchParams();
  const requested = search.get("tool");
  const [tool, setTool] = useState<ToolKey>(
    requested && requested in LONGFORM_TOOL_CONFIG
      ? (requested as ToolKey)
      : "continuity",
  );
  const [refreshKey, setRefreshKey] = useState(0);
  const configuration = LONGFORM_TOOL_CONFIG[tool];
  return (
    <div className={styles.c1}>
      <section className={styles.c4}>
        <h2 className={styles.c5}>
          {copyText("app/features/novel/NovelProjectSections.2")}
        </h2>
        <p className={styles.c6}>
          {copyText("app/features/novel/NovelProjectSections.3")}
        </p>
        <nav
          className={styles.c7}
          aria-label={copyText("app/features/novel/NovelProjectSections.4")}
        >
          {(
            Object.entries(LONGFORM_TOOL_CONFIG) as Array<
              [ToolKey, (typeof LONGFORM_TOOL_CONFIG)[ToolKey]]
            >
          ).map(([value, item]) => (
            <BareButton
              key={value}
              className={clsx(
                styles.c8,
                tool === value ? styles.k3 : styles.k4,
              )}
              onClick={() => setTool(value)}
            >
              {item.label}
            </BareButton>
          ))}
        </nav>
      </section>
      <>
        <NovelInsightRunner
          key={`runner:${tool}`}
          client={props.client}
          projectId={props.projectId}
          taskType={configuration.taskType}
          title={configuration.title}
          description={`${configuration.description} 结果先给你看，点“保存到项目”后才会留存。`}
          prompt={configuration.prompt}
          domain={configuration.domain}
          itemName={configuration.itemName}
          resultField={configuration.resultField}
          chapters={props.chapters}
          initialChapterId={
            tool === requested ? (search.get("chapterId") ?? "") : ""
          }
          onSaved={() => setRefreshKey((value) => value + 1)}
        />
        <NovelResourceSection
          key={`${tool}:${refreshKey}`}
          client={props.client}
          projectId={props.projectId}
          domain={configuration.domain}
          title={copyText("app/features/novel/NovelProjectSections.36", {
            p1: configuration.itemName,
          })}
          description={configuration.description}
          itemName={configuration.itemName}
          titleLabel={configuration.titleLabel}
          fields={configuration.fields}
          filter={(item) => {
            const type = String(payloadRecord(item.payload)["分析类型"] ?? "");
            if (tool === "continuity") return type.includes("一致性");
            if (tool === "room") return type.includes("编剧室");
            if (tool === "opening") return type.includes("开篇");
            return (
              !type.includes("一致性") &&
              !type.includes("编剧室") &&
              !type.includes("开篇")
            );
          }}
        />
      </>
    </div>
  );
}

/** A read-only look at the story memory AI keeps as chapters are written. */
export function StoryMemoryView(props: {
  client: StudioClient;
  projectId: string;
}) {
  const [view, setView] =
    useState<(typeof STORY_MEMORY_VIEWS)[number]["domain"]>("chapter-memories");
  const [items, setItems] = useState<DomainEntity[]>();
  const [notice, setNotice] = useState<string>();
  const current =
    STORY_MEMORY_VIEWS.find((item) => item.domain === view) ??
    STORY_MEMORY_VIEWS[0];
  useEffect(() => {
    let live = true;
    setItems(undefined);
    setNotice(undefined);
    props.client.resources.list(view, props.projectId).then(
      (next) => {
        if (live) setItems(next);
      },
      (cause: unknown) => {
        if (live)
          setNotice(cause instanceof Error ? cause.message : String(cause));
      },
    );
    return () => {
      live = false;
    };
  }, [props.client, props.projectId, view]);
  return (
    <section
      className={styles.c4}
      aria-label={copyText("app/features/novel/NovelProjectSections.30")}
    >
      <div className={styles.c10}>
        <h2 className={styles.c5}>
          {copyText("app/features/novel/NovelProjectSections.30")}
        </h2>
        <p className={styles.c11}>
          {copyText("app/features/novel/NovelProjectSections.31")}
        </p>
      </div>
      <nav
        className={styles.c7}
        aria-label={copyText("app/features/novel/NovelProjectSections.32")}
      >
        {STORY_MEMORY_VIEWS.map((item) => (
          <BareButton
            key={item.domain}
            className={clsx(
              styles.c8,
              view === item.domain ? styles.k3 : styles.k4,
            )}
            aria-pressed={view === item.domain}
            onClick={() => setView(item.domain)}
          >
            {item.label}
          </BareButton>
        ))}
      </nav>
      {notice && <p className={styles.c15}>{notice}</p>}
      <div className={styles.c16}>
        {items?.map((item) => {
          const payload = payloadRecord(item.payload);
          return (
            <article key={item.id} className={styles.c17}>
              <h3 className={styles.c20}>{item.title}</h3>
              <dl className={styles.c21}>
                {current.fields
                  .filter(([key]) => memoryText(payload[key]))
                  .map(([key, label]) => (
                    <div key={key}>
                      <dt className={styles.c22}>{label}</dt>
                      <dd className={styles.c23}>{memoryText(payload[key])}</dd>
                    </div>
                  ))}
              </dl>
            </article>
          );
        })}
        {items && !items.length && (
          <p className={styles.c27}>
            {copyText("app/features/novel/NovelProjectSections.33", {
              p1: current.label,
            })}
          </p>
        )}
        {!items && !notice && (
          <p className={styles.c27}>
            {copyText("app/features/novel/NovelProjectSections.34")}
          </p>
        )}
      </div>
    </section>
  );
}

function memoryText(value: unknown): string {
  if (Array.isArray(value))
    return value.map(memoryText).filter(Boolean).join("、");
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return agentResultText(value);
  return String(value).trim();
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
    <section className={styles.c4}>
      <div className={styles.c9}>
        <div className={styles.c10}>
          <h2 className={styles.c5}>{props.title}</h2>
          <p className={styles.c11}>{props.description}</p>
        </div>
        <BareButton className={styles.c12} onClick={() => open("new")}>
          {copyText("app/features/novel/NovelProjectSections.5")}
          {props.itemName}
        </BareButton>
      </div>
      {props.generator && (
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
      )}
      {notice && <p className={styles.c15}>{notice}</p>}
      <div className={styles.c16}>
        {visibleItems.map((item) => {
          const payload = payloadRecord(item.payload);
          return (
            <article key={item.id} className={styles.c17}>
              <div className={styles.c18}>
                <div className={styles.c19}>
                  <h3 className={styles.c20}>{item.title}</h3>
                  <dl className={styles.c21}>
                    {props.fields
                      .filter((field) =>
                        String(payload[field.key] ?? "").trim(),
                      )
                      .slice(0, 4)
                      .map((field) => (
                        <div key={field.key}>
                          <dt className={styles.c22}>{field.label}</dt>
                          <dd className={styles.c23}>
                            {String(payload[field.key])}
                          </dd>
                        </div>
                      ))}
                  </dl>
                </div>
                <div className={styles.c24}>
                  <BareButton className={styles.c25} onClick={() => open(item)}>
                    {copyText("app/features/novel/NovelProjectSections.7")}
                  </BareButton>
                  <BareButton
                    className={styles.c26}
                    onClick={() => void remove(item)}
                  >
                    {copyText("app/features/novel/NovelProjectSections.8")}
                  </BareButton>
                </div>
              </div>
            </article>
          );
        })}
        {!visibleItems.length && (
          <p className={styles.c27}>
            {copyText("app/features/novel/NovelProjectSections.9")}
            {props.itemName}
            {copyText("app/features/novel/NovelProjectSections.10")}
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
            className={styles.c28}
            aria-label={copyText("app/features/novel/NovelProjectSections.29", {
              p1: props.itemName,
            })}
          >
            <div>
              <Dialog.Title>
                {editor === "new"
                  ? `新建${props.itemName}`
                  : `编辑${props.itemName}`}
              </Dialog.Title>
            </div>
            <label className={styles.c29}>
              {props.titleLabel}
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <div className={styles.c30}>
              {props.fields.map((field) => (
                <label key={field.key} className={styles.c31}>
                  {field.label}
                  {field.multiline ? (
                    <Textarea
                      className={styles.c32}
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
            <div className={styles.c33}>
              <Button variant="secondary" onClick={() => setEditor(undefined)}>
                {copyText("app/features/novel/NovelProjectSections.11")}
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

/** Run statuses after which the run may still produce its answer. */
const ACTIVE_RUN_STATUSES = new Set([
  "created",
  "queued",
  "preparing",
  "running",
  "waiting_approval",
  "committing",
]);

/** The answer a finished run gave: its messages, else its structured output. */
function runOutput(items: readonly AgentItem[]): string {
  const ordered = [...items].sort((a, b) => a.sequence - b.sequence);
  const messages = ordered
    .filter((item) => item.type === "message" && item.content?.trim())
    .map((item) => item.content!.trim());
  if (messages.length) return messages.join("\n\n");
  const structured = ordered.find((item) => item.type === "structured_output");
  return structured
    ? agentResultText(structured.content ?? structured.payload)
    : "";
}

function NovelInsightRunner(props: {
  client: StudioClient;
  projectId: string;
  taskType: AgentTaskType;
  title: string;
  description: string;
  /** What to ask when the author adds nothing; never empty. */
  prompt: string;
  domain: string;
  itemName: string;
  resultField: string;
  chapters: Chapter[];
  initialChapterId?: string;
  onSaved(): void;
}) {
  const [instruction, setInstruction] = useState("");
  const [runId, setRunId] = useState<string>();
  const [taskId, setTaskId] = useState<string>();
  const [chapterId, setChapterId] = useState(props.initialChapterId ?? "");
  const studioSession = useStudioSession();
  const navigate = useNavigate();
  const [output, setOutput] = useState("");
  const [notice, setNotice] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const issues =
    props.taskType === "review_opening" && output.trim()
      ? parseOpeningIssues(output)
      : [];
  /** Opens the chapter with an instruction that fixes just this problem. */
  const fix = (issue: OpeningIssue) => {
    const ordered = [...props.chapters].sort(
      (a, b) => a.orderIndex - b.orderIndex,
    );
    const chapter =
      (issue.chapter ? ordered[issue.chapter - 1] : undefined) ??
      ordered.find((item) => item.id === chapterId) ??
      ordered[0];
    if (!chapter) return;
    const to = `/projects/${encodeURIComponent(props.projectId)}?section=chapters&chapterId=${encodeURIComponent(chapter.id)}`;
    studioSession.savePendingIntent({
      kind: "ai-action",
      actionId: "novel-chapter:opening-fix",
      projectId: props.projectId,
      chapterId: chapter.id,
      input: openingFixInstruction(issue),
      returnTo: to,
    });
    navigate(to);
  };
  useEffect(() => {
    if (!runId) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (text: string, message: string, failure = false) => {
      setBusy(false);
      setOutput(text);
      setNotice(message);
      setFailed(failure);
    };
    const poll = async () => {
      try {
        const run = await props.client.agentSessions.getRun(runId);
        if (!live) return;
        if (ACTIVE_RUN_STATUSES.has(run.status)) {
          timer = setTimeout(() => void poll(), 1_500);
          return;
        }
        if (run.status !== "completed") {
          finish(
            "",
            run.status === "interrupted" || run.status === "aborted"
              ? "本次分析已中断。"
              : (run.error ?? "分析没有完成，请重试。"),
            run.status !== "interrupted" && run.status !== "aborted",
          );
          return;
        }
        const text = runOutput(
          await props.client.agentSessions.listItems(runId),
        );
        if (!live) return;
        finish(
          text,
          text.trim()
            ? "分析完成，核对后可以保存到项目。"
            : "AI 这次没有返回内容，请重试。",
        );
      } catch (cause) {
        if (live)
          finish(
            "",
            cause instanceof Error ? cause.message : String(cause),
            true,
          );
      }
    };
    void poll();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [props.client, runId]);
  const run = async () => {
    setBusy(true);
    setOutput("");
    setFailed(false);
    setNotice("正在阅读章节和资料…");
    try {
      const settings = await props.client.agentEngines.getProjectSettings(
        props.projectId,
      );
      const model = settings.defaultModel
        ? { model: { ...settings.defaultModel } }
        : {};
      const session = await props.client.agentSessions.create({
        projectId: props.projectId,
        ...(chapterId ? { chapterId } : {}),
        engineKind: settings.defaultEngineKind,
        taskType: props.taskType,
        title: props.title,
        ...model,
      });
      const started = await props.client.agentSessions.run(
        session.id,
        {
          taskType: props.taskType,
          prompt: [props.prompt, instruction.trim()]
            .filter(Boolean)
            .join("\n\n补充要求：\n"),
          ...model,
        },
        crypto.randomUUID(),
      );
      setTaskId(started.taskId);
      setRunId(started.runId);
    } catch (cause) {
      setBusy(false);
      setFailed(true);
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
                    : props.taskType === "review_opening"
                      ? "开篇检查"
                      : props.taskType.startsWith("writing_room")
                        ? "编剧室审稿"
                        : "创作分析",
              }
            : {}),
          关联章节:
            props.chapters.find((chapter) => chapter.id === chapterId)?.title ??
            "整个项目",
          来源: props.title,
          任务标识: taskId ?? "",
        },
      });
      setNotice("已保存到项目。");
      props.onSaved();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={styles.c34}>
      <div className={styles.c9}>
        <div className={styles.c10}>
          <h2 className={styles.c20}>{props.title}</h2>
          <p className={styles.c35}>{props.description}</p>
        </div>
      </div>
      <textarea
        className={styles.c38}
        value={instruction}
        disabled={busy}
        aria-label={copyText("app/features/novel/NovelProjectSections.13")}
        placeholder={copyText("app/features/novel/NovelProjectSections.14")}
        onChange={(event) => setInstruction(event.target.value)}
      />
      {props.taskType === "writing_room_review" && (
        <p className={styles.c39}>
          {copyText("app/features/novel/NovelProjectSections.15")}
        </p>
      )}
      <label className={styles.c40}>
        {copyText("app/features/novel/NovelProjectSections.16")}
        <NativeSelect
          className={styles.c37}
          value={chapterId}
          disabled={busy}
          onChange={(event) => setChapterId(event.target.value)}
        >
          <option value="">
            {copyText("app/features/novel/NovelProjectSections.17")}
          </option>
          {props.chapters.map((chapter) => (
            <option key={chapter.id} value={chapter.id}>
              {chapter.title}
            </option>
          ))}
        </NativeSelect>
      </label>
      <div className={styles.c41}>
        <BareButton
          className={styles.c42}
          disabled={busy}
          onClick={() => void run()}
        >
          {busy ? "正在分析…" : `开始${props.title}`}
        </BareButton>
        {busy && runId && (
          <BareButton
            className={styles.c43}
            onClick={() => void props.client.agentSessions.interrupt(runId)}
          >
            {copyText("app/features/novel/NovelProjectSections.18")}
          </BareButton>
        )}
        {output.trim() && (
          <BareButton
            className={styles.c44}
            disabled={busy}
            onClick={() => void save()}
          >
            {copyText("app/features/novel/NovelProjectSections.19")}
          </BareButton>
        )}
      </div>
      {notice && (
        <p className={styles.c45} role={failed ? "alert" : "status"}>
          {notice}
          {failed && (
            <>
              {" "}
              <AiSettingsLink
                actionId={`novel-tool:${props.taskType}`}
                projectId={props.projectId}
              >
                {copyText("app/features/novel/NovelProjectSections.35")}
              </AiSettingsLink>
            </>
          )}
        </p>
      )}
      {output.trim() && <div className={styles.c46}>{output}</div>}
      {issues.length > 0 && (
        <ol
          className={styles.openingIssues}
          aria-label={copyText("app/features/novel/NovelProjectSections.37")}
        >
          {issues.map((issue, index) => (
            <li key={index} className={styles.openingIssue}>
              <p>
                {issue.chapter ? `第 ${issue.chapter} 章 · ` : ""}
                {issue.summary || issue.suggestion}
              </p>
              <BareButton
                className={styles.c44}
                disabled={busy}
                onClick={() => fix(issue)}
              >
                {copyText("app/features/novel/NovelProjectSections.38")}
              </BareButton>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
