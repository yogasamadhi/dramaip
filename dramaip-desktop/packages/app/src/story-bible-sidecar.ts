import type {
  DomainEntity,
  StoryBibleChangeSet,
  StoryBibleStaleMark,
} from "@sdns/schema";

export type StoryBibleContext = {
  kind: "chapter" | "script";
  id: string;
  title: string;
  content: string;
  version: number;
};

export type StoryBibleSidecarState =
  "authoritative" | "confirmed" | "suggested" | "stale";

export type StoryBibleSidecarItem = {
  id: string;
  group:
    | "人物"
    | "关系与设定"
    | "时间线"
    | "伏笔"
    | "视觉锁"
    | "章节记忆"
    | "变更草案";
  title: string;
  text: string;
  state: StoryBibleSidecarState;
  domain: string;
  sourceId: string;
  sourceVersion?: number;
};

export type StoryBibleSidecarModel = {
  items: StoryBibleSidecarItem[];
  relevantChangeSets: StoryBibleChangeSet[];
  staleMarks: StoryBibleStaleMark[];
};

const payload = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const text = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const relevant = (entity: DomainEntity, context: StoryBibleContext) => {
  const values = payload(entity.payload);
  const references = Object.values(values)
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  return (
    entity.domain === "story-bible" ||
    references.includes(context.id) ||
    references.includes(context.title) ||
    context.content.includes(entity.title)
  );
};

const stateFor = (entity: DomainEntity): StoryBibleSidecarState => {
  const status = text(
    payload(entity.payload)["状态"] ?? payload(entity.payload)["采用状态"],
  );
  if (/过期|stale|待更新/.test(status)) return "stale";
  if (/待确认|草案|建议/.test(status)) return "suggested";
  if (/已采用|已确认/.test(status)) return "confirmed";
  return "authoritative";
};

const itemText = (entity: DomainEntity) => {
  const values = payload(entity.payload);
  return [
    "人物目标",
    "关系与秘密",
    "变更说明",
    "事件描述",
    "伏笔说明",
    "回收计划",
    "视觉提示",
    "章节摘要",
    "重要事件",
    "人物变化与秘密",
    "新增或回收伏笔",
    "锁定说明",
  ]
    .map((key) => text(values[key]))
    .filter(Boolean)
    .join("\n");
};

const groupFor = (domain: string): StoryBibleSidecarItem["group"] | undefined =>
  ({
    characters: "人物",
    "story-bible": "关系与设定",
    outlines: "关系与设定",
    "character-states": "人物",
    "story-events": "时间线",
    foreshadowings: "伏笔",
    "visual-assets": "视觉锁",
    "visual-settings": "视觉锁",
    assets: "视觉锁",
    "chapter-memories": "章节记忆",
  })[domain] as StoryBibleSidecarItem["group"] | undefined;

const isLockedVisual = (entity: DomainEntity) => {
  if (!["visual-assets", "assets"].includes(entity.domain)) return true;
  const values = payload(entity.payload);
  return /锁定|已采用|approved/i.test(
    [values["锁定状态"], values["状态"], values["采用状态"], values["用途"]]
      .map(text)
      .join(" "),
  );
};

export function buildStoryBibleSidecar(input: {
  context: StoryBibleContext;
  records: DomainEntity[];
  changeSets: StoryBibleChangeSet[];
  staleMarks: StoryBibleStaleMark[];
}): StoryBibleSidecarModel {
  const items = input.records.flatMap((entity): StoryBibleSidecarItem[] => {
    const group = groupFor(entity.domain);
    if (!group || !relevant(entity, input.context) || !isLockedVisual(entity))
      return [];
    return [
      {
        id: entity.id,
        group,
        title: entity.title,
        text: itemText(entity) || "已记录，展开来源查看详情。",
        state: stateFor(entity),
        domain: entity.domain,
        sourceId: entity.id,
        sourceVersion: entity.version,
      },
    ];
  });
  const relevantChangeSets = input.changeSets.filter(
    (changeSet) =>
      input.context.kind === "chapter" &&
      changeSet.chapterId === input.context.id,
  );
  for (const changeSet of relevantChangeSets) {
    const state: StoryBibleSidecarState =
      changeSet.status === "stale"
        ? "stale"
        : changeSet.status === "applied"
          ? "confirmed"
          : "suggested";
    items.push({
      id: `change-set:${changeSet.id}`,
      group: "变更草案",
      title: changeSet.summary,
      text: `章节版本 ${changeSet.sourceVersion} · ${changeSet.status}`,
      state,
      domain: "story-bible",
      sourceId: changeSet.id,
      sourceVersion: changeSet.sourceVersion,
    });
  }
  const staleMarks = input.staleMarks.filter(
    (mark) =>
      input.context.kind === "chapter" && mark.chapterId === input.context.id,
  );
  return {
    items: items.sort(
      (left, right) =>
        left.group.localeCompare(right.group) ||
        left.title.localeCompare(right.title),
    ),
    relevantChangeSets,
    staleMarks,
  };
}
