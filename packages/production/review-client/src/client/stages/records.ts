import type { TranslateNS } from "@dramaip/infra-ui-slots";
import type {
  RecordEntity,
  RecordField,
  RecordsDomain,
  RecordsStore,
} from "@dramaip/workspace-workspace-client/client/contract";
import {
  saveDocument,
  value,
  type DeliveryRemote,
  type QualityRemote,
  type ReviewRemote,
  type StageRemotes,
  type TextDocument,
} from "../remote.ts";

type Translate = TranslateNS<"review">;

/** The record domains the review stages keep. */
export type ReviewRecordDomain =
  "quality" | "compliance" | "review" | "localization" | "delivery";

/** A Remote answer, as every records method gives one. */
type Answer = Promise<
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string; details?: unknown } }
>;

/** The five records calls of one domain, as its namespace names them. */
interface RecordsCalls {
  list(query: { projectId?: string; parentId?: string }): Answer;
  create(input: never, ifMatch: undefined, key: undefined): Answer;
  update(id: string, input: never, ifMatch: string, key: undefined): Answer;
  remove(id: string, ifMatch: undefined, key: undefined): Answer;
}

/**
 * Bind one domain's records calls to the records workspace's store: the
 * list in its project and parent, a new record under them, an update
 * against its version, a removal.
 */
function store(calls: RecordsCalls): RecordsStore {
  return {
    list: ({ projectId, parentId }) =>
      value<readonly RecordEntity[]>(
        calls.list({
          ...(projectId ? { projectId } : {}),
          ...(parentId ? { parentId } : {}),
        }),
      ),
    create: (input) =>
      value(
        calls.create(
          {
            projectId: input.projectId ?? "",
            ...(input.parentId ? { parentId: input.parentId } : {}),
            title: input.title,
            payload: input.payload,
          } as never,
          undefined,
          undefined,
        ),
      ),
    update: (id, input) =>
      value(calls.update(id, input as never, `"${input.version}"`, undefined)),
    remove: (id) => value(calls.remove(id, undefined, undefined)),
  };
}

const qualityCalls = (quality: QualityRemote): RecordsCalls => ({
  list: (query) => quality.list(query),
  create: (input) => quality.create(input, undefined, undefined),
  update: (id, input, ifMatch) => quality.update(id, input, ifMatch, undefined),
  remove: (id) => quality.qualityRemove(id, undefined, undefined),
});

const complianceCalls = (review: ReviewRemote): RecordsCalls => ({
  list: (query) => review.complianceRecordsList(query),
  create: (input) =>
    review.complianceRecordsCreate(input, undefined, undefined),
  update: (id, input, ifMatch) =>
    review.complianceRecordsUpdate(id, input, ifMatch, undefined),
  remove: (id) => review.complianceRecordsRemove(id, undefined, undefined),
});

const reviewCalls = (review: ReviewRemote): RecordsCalls => ({
  list: (query) => review.recordsList(query),
  create: (input) => review.recordsCreate(input, undefined, undefined),
  update: (id, input, ifMatch) =>
    review.recordsUpdate(id, input, ifMatch, undefined),
  remove: (id) => review.recordsRemove(id, undefined, undefined),
});

const localizationCalls = (delivery: DeliveryRemote): RecordsCalls => ({
  list: (query) => delivery.localizationRecordsList(query),
  create: (input) =>
    delivery.localizationRecordsCreate(input, undefined, undefined),
  update: (id, input, ifMatch) =>
    delivery.localizationRecordsUpdate(id, input, ifMatch, undefined),
  remove: (id) => delivery.localizationRecordsRemove(id, undefined, undefined),
});

const deliveryCalls = (delivery: DeliveryRemote): RecordsCalls => ({
  list: (query) => delivery.recordsList(query),
  create: (input) => delivery.recordsCreate(input, undefined, undefined),
  update: (id, input, ifMatch) =>
    delivery.recordsUpdate(id, input, ifMatch, undefined),
  remove: (id) => delivery.recordsRemove(id, undefined, undefined),
});

/** The payload keys stay the stored ones; only their labels translate. */
const short = (key: string, label: string): RecordField => ({
  key,
  label,
  kind: "text",
});
const long = (key: string, label: string): RecordField => ({
  key,
  label,
  kind: "multiline",
});

/**
 * Describe one review record domain to the records workspace: its copy,
 * fields, store and actions.
 * @param id - the domain.
 * @param remotes - the stages' Remote namespaces.
 * @param t - the review copy.
 */
export function recordDomain(
  id: ReviewRecordDomain,
  remotes: Pick<StageRemotes, "quality" | "review" | "delivery" | "system">,
  t: Translate,
): RecordsDomain {
  const base = {
    id,
    label: t(`records.${id}`),
    description: t(`records.${id}.description`),
    titleLabel: t(`records.${id}.name`),
  };
  const save = async (
    document: Promise<TextDocument>,
    saved: string,
    cancelled: string,
  ) =>
    (await saveDocument(remotes.system, await document)) ? saved : cancelled;
  switch (id) {
    case "quality":
      return {
        ...base,
        store: store(qualityCalls(remotes.quality)),
        fields: [
          short("关联分集", t("records.field.episode")),
          short("严重程度", t("records.field.severity")),
          long("问题描述", t("records.field.issue")),
          long("返工方案", t("records.field.redo")),
        ],
      };
    case "compliance":
      return {
        ...base,
        store: store(complianceCalls(remotes.review)),
        fields: [
          short("规则来源", t("records.field.ruleSource")),
          short("检查状态", t("records.field.checkState")),
          long("风险与依据", t("records.field.risk")),
          long("处理说明", t("records.field.handling")),
        ],
      };
    case "review":
      return {
        ...base,
        store: store(reviewCalls(remotes.review)),
        fields: [
          short("审片方式", t("records.field.reviewMode")),
          short("审片状态", t("records.field.reviewState")),
          long("评论", t("records.field.comments")),
          long("决策与跟进", t("records.field.decisions")),
        ],
      };
    case "localization": {
      const subtitles = (item: RecordEntity, format: "srt" | "vtt" | "txt") =>
        save(
          value<TextDocument>(
            remotes.delivery.localizationSubtitles(item.id, format),
          ),
          t("records.action.subtitles.saved"),
          t("records.action.subtitles.cancelled"),
        );
      return {
        ...base,
        store: store(localizationCalls(remotes.delivery)),
        fields: [
          short("目标语言", t("records.field.language")),
          short("关联分集", t("records.field.episode")),
          long("字幕与译文", t("records.field.subtitles")),
          short("采用状态", t("records.field.adoption")),
        ],
        actions: (item) => [
          {
            key: "adopt",
            label: t("records.action.adopt"),
            row: true,
            run: async () => {
              await value(
                remotes.delivery.localizationAdopt(
                  item.id,
                  undefined,
                  undefined,
                ),
              );
              return t("records.action.adopted");
            },
          },
          ...(["srt", "vtt", "txt"] as const).map((format) => ({
            key: format,
            label: t(`records.action.${format}`),
            row: true,
            run: () => subtitles(item, format),
          })),
        ],
      };
    }
    case "delivery":
      return {
        ...base,
        store: store(deliveryCalls(remotes.delivery)),
        fields: [
          short("目标平台", t("records.field.platform")),
          short("交付状态", t("records.field.deliveryState")),
          long("预检结果", t("records.field.preflight")),
          long("交付说明", t("records.field.deliveryNote")),
        ],
        actions: (item) => [
          {
            key: "export",
            label: t("records.action.export"),
            run: () =>
              save(
                value<TextDocument>(remotes.delivery.export(item.id)),
                t("records.action.export.saved"),
                t("records.action.export.cancelled"),
              ),
          },
        ],
      };
  }
}
