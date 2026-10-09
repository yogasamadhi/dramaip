import {
  PilotWorkflowLineageSchema,
  type PilotWorkflowLineage,
} from "./pilot-workflow-lineage.js";
import { createHash } from "node:crypto";
import { zipSync, type Zippable } from "fflate";
import type {
  PilotPackageManifest,
  PilotPackagePreview,
} from "@dramaip/contracts/delivery";
import type {
  EpisodeDevelopmentBasis,
  EpisodeDevelopmentResult,
} from "@dramaip/contracts/production";
import {
  EpisodeSceneEvidenceSchema,
  StoryboardAttributionExportSchema,
  type StoryboardAttributionExport,
} from "@dramaip/contracts/production";

export const pilotHash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
export function pilotFile(
  fileName: string,
  mimeType: string,
  content: string,
): PilotPackagePreview["files"][number] {
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/u.test(fileName) ||
    fileName.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("试制文件名必须是安全的相对引用。");
  return {
    fileName,
    mimeType,
    content,
    sha256: pilotHash(content),
    byteSize: Buffer.byteLength(content, "utf8"),
  };
}
export function pilotArchive(files: PilotPackagePreview["files"]) {
  const entries: Zippable = {};
  let size = 0;
  for (const file of files) {
    const checked = pilotFile(file.fileName, file.mimeType, file.content);
    if (
      Object.hasOwn(entries, file.fileName) ||
      checked.sha256 !== file.sha256 ||
      checked.byteSize !== file.byteSize
    )
      throw new Error("试制文件重复或完整性不匹配。");
    size += file.byteSize;
    if (size > 30_000_000)
      throw new Error("试制包超出当前 30 MB 结构化文件上限。");
    entries[file.fileName] = [
      Buffer.from(file.content, "utf8"),
      { mtime: new Date(1980, 0, 1), level: 0 },
    ];
  }
  const bytes = zipSync(entries, { level: 0 });
  return {
    base64: Buffer.from(bytes).toString("base64"),
    sha256: pilotHash(bytes),
    byteSize: bytes.length,
  };
}
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
// RFC 4180 quoting plus formula neutralisation for spreadsheet consumers.
export const pilotCsvCell = (value: unknown) => {
  const text = String(value);
  return `"${(/^[\s]*[=+\-@]/u.test(text) ? "'" : "") + text.replace(/"/gu, '""')}"`;
};
function timecode(seconds: number) {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
}
const identity = ({ id, version }: { id: string; version: number }) => ({
  id,
  version,
});

/** Frozen input identity is evidence of supplied context, not semantic use. */
export function pilotSourceContext(
  results: readonly (Pick<
    EpisodeDevelopmentResult,
    | "id"
    | "version"
    | "operation"
    | "workflowId"
    | "sourceSnapshotId"
    | "origin"
    | "scriptRevision"
    | "topologyRevision"
    | "sourceRevision"
  > & {
    basis: Pick<
      EpisodeDevelopmentBasis,
      "request" | "chapters" | "contextChapters" | "sourceBasis" | "references"
    >;
  })[],
) {
  return {
    schemaVersion: 1,
    purpose: results.some(
      (result) =>
        result.origin === "human-script-revision" ||
        result.origin === "human-topology-revision" ||
        result.origin === "human-source-revision",
    )
      ? "frozen-generation-and-human-confirmation-basis-evidence"
      : "frozen-generation-input-evidence",
    textIncluded: false,
    provesModelUnderstanding: false,
    provesParagraphToShotMapping: false,
    stages: results.map((result) => {
      const { basis } = result;
      const direct = basis.request.direct;
      const selected = basis.sourceBasis;
      return {
        result: identity(result),
        operation: result.operation,
        workflowId: result.workflowId,
        sourceSnapshotId: result.sourceSnapshotId,
        ...(result.origin === "human-script-revision"
          ? {
              origin: result.origin,
              scriptRevision: result.scriptRevision,
              inputEvidence: "inherited-confirmed-basis-not-new-model-input",
            }
          : result.origin === "human-source-revision"
            ? {
                origin: result.origin,
                sourceRevision: result.sourceRevision,
                inputEvidence:
                  "new-explicit-human-source-basis-not-model-input",
              }
            : result.origin === "human-topology-revision"
              ? {
                  origin: result.origin,
                  topologyRevision: result.topologyRevision,
                  inputEvidence:
                    "inherited-confirmed-basis-not-new-model-input",
                }
              : {}),
        inputKind: direct
          ? "direct-source"
          : selected
            ? basis.request.episodeNarrativeContext
              ? "author-selected-episode-expressions"
              : "author-selected-season-expressions"
            : "episode-originals",
        episodeChapterMapping: basis.chapters.map(identity),
        contextChapters: (basis.contextChapters ?? basis.chapters).map(
          identity,
        ),
        ...(direct
          ? {
              directSource: {
                entryPath: direct.entryPath,
                project: identity(direct.project),
                episode: identity(direct.episode),
                authorIntent: identity(direct.authorIntent),
                ...(direct.sourceScript
                  ? {
                      sourceScript: {
                        ...identity(direct.sourceScript),
                        documentVersion: direct.sourceScript.documentVersion,
                      },
                    }
                  : {}),
              },
            }
          : {}),
        ...(selected
          ? {
              selection: {
                ...(basis.request.episodeNarrativeContext
                  ? {
                      omitted: selected.omitted.map((chapter) => ({
                        ...identity(chapter),
                        reason: chapter.reason,
                      })),
                    }
                  : {}),
                chapters: selected.chapters.map((chapter) => ({
                  ...identity(chapter),
                  representation: chapter.representation,
                  contentHash: chapter.contentHash,
                  ...(chapter.representation === "paragraphs"
                    ? { paragraphIds: [...chapter.paragraphIds] }
                    : chapter.representation === "summary"
                      ? { record: identity(chapter.record) }
                      : {}),
                })),
                ...(selected.story === undefined
                  ? {}
                  : {
                      storyInterpretations: selected.story.map((story) => ({
                        selection: {
                          ...identity(story.selection),
                          kind: story.selection.kind,
                        },
                        record: {
                          ...identity(story.record),
                          kind: story.record.kind,
                        },
                        sourceFingerprint: story.sourceFingerprint,
                        contentHash: story.contentHash,
                        sourceChapters: story.sourceChapters.map(identity),
                        sourceScripts: story.sourceScripts.map(identity),
                        evidencePolicy:
                          "frozen-selected-interpretation-not-semantic-proof-or-shot-attribution",
                      })),
                    }),
                higherSummaries: (selected.summaries ?? []).map((summary) => ({
                  ...identity(summary),
                  target: {
                    ...identity(summary.target),
                    kind: summary.target.kind,
                  },
                  scopeFingerprint: summary.scopeFingerprint,
                  frozenScopeState: summary.scopeState,
                  chapters: summary.chapters.map((chapter) => ({
                    ...identity(chapter),
                    contentHash: chapter.contentHash,
                  })),
                })),
              },
            }
          : {}),
        references: basis.references.map((ref) => ({
          sourceKind: ref.sourceKind,
          sourceId: ref.sourceId,
          sourceVersion: ref.sourceVersion,
          fieldPath: ref.fieldPath,
          contentHash: ref.contentHash,
        })),
      };
    }),
  };
}

export function pilotContentFiles(input: {
  storyboard: EpisodeDevelopmentResult;
  script: EpisodeDevelopmentResult;
  outline: EpisodeDevelopmentResult;
  fountain: string;
  manifest: Omit<PilotPackageManifest, "files">;
  nle: { fileName: string; mimeType: string; content: string }[];
  shotAttribution?: StoryboardAttributionExport;
  workflowLineage?: PilotWorkflowLineage;
}) {
  const { storyboard, script, outline } = input;
  if (
    storyboard.content.kind !== "storyboard-package" ||
    script.content.kind !== "episode-script" ||
    outline.content.kind !== "episode-outline"
  )
    throw new Error("试制包缺少正式强类型内容。");
  const workflowLineage = input.workflowLineage
    ? PilotWorkflowLineageSchema.parse(input.workflowLineage)
    : undefined;
  if (
    workflowLineage &&
    (workflowLineage.sourceProject.id !== input.manifest.projectId ||
      workflowLineage.sourceProject.version !== input.manifest.projectVersion ||
      workflowLineage.stages.some(
        (stage) =>
          ![outline, script, storyboard].some(
            (result) =>
              result.id === stage.result.id &&
              result.version === stage.result.version &&
              result.operation === stage.operation &&
              (result.origin ?? "historical-origin-unspecified") ===
                stage.origin,
          ),
      ))
  )
    throw new Error("试制谱系与所选正式阶段不符，不自动附最新记录。");
  const content = storyboard.content.value;
  const shotAttribution = input.shotAttribution
    ? StoryboardAttributionExportSchema.parse(input.shotAttribution)
    : undefined;
  if (
    JSON.stringify(input.manifest.adopted.shotAttribution ?? null) !==
      JSON.stringify(shotAttribution?.attribution ?? null) ||
    (shotAttribution &&
      (shotAttribution.projectId !== input.manifest.projectId ||
        shotAttribution.storyboard.id !== storyboard.id ||
        shotAttribution.storyboard.version !== storyboard.version ||
        shotAttribution.outline.id !== outline.id ||
        shotAttribution.outline.version !== outline.version ||
        shotAttribution.script.id !== script.id ||
        shotAttribution.script.version !== script.version))
  )
    throw new Error(
      "交付包明确关联与实际正式版本不一致，不自动附最新或未知关联。",
    );
  const shots = content.scenes.flatMap((scene) =>
    scene.shots.map((shot) => ({ ...shot, sceneId: scene.sceneId })),
  );
  let offset = 0;
  const offsets = new Map<string, number>();
  for (const shot of shots) {
    offsets.set(shot.id, offset);
    offset += shot.durationSeconds;
  }
  const subtitles = content.subtitles
    .map((cue) => ({
      ...cue,
      start: offsets.get(cue.shotId)! + cue.startSeconds,
      end: offsets.get(cue.shotId)! + cue.endSeconds,
    }))
    .sort((a, b) => a.start - b.start);
  const csv =
    [
      [
        "scene_id",
        "shot_id",
        "order",
        "duration_seconds",
        "visual_action",
        "composition",
        "camera",
        "movement",
        "sound",
        "prompt",
        "negative_prompt",
        "asset_ids",
        "source_block_ids",
      ],
      ...shots.map((shot) => [
        shot.sceneId,
        shot.id,
        shot.orderIndex,
        shot.durationSeconds,
        shot.visualAction,
        shot.composition,
        shot.camera,
        shot.movement,
        shot.sound,
        shot.prompt,
        shot.negativePrompt,
        shot.assetIds.join(";"),
        shot.sourceBlockIds.join(";"),
      ]),
    ]
      .map((row) => row.map(pilotCsvCell).join(","))
      .join("\r\n") + "\r\n";
  const sourceEvidence = outline.sourceEvidence?.map((item) =>
    EpisodeSceneEvidenceSchema.parse(item),
  );
  const lineage = outline.content.value.scenes.map((scene) => ({
    sceneId: scene.id,
    ...(sourceEvidence
      ? {
          sourceEvidence: sourceEvidence.filter(
            (item) => item.sceneId === scene.id,
          ),
          downstreamAssociation:
            "via-declared-scene-not-shot-specific-attribution",
        }
      : {}),
    sourceChapters: scene.sourceChapters,
    ...(scene.sourceReferences
      ? { sourceReferences: scene.sourceReferences }
      : {}),
    scriptBlockIds:
      script.content.kind === "episode-script"
        ? script.content.value.sceneLinks.find(
            (link) => link.sceneId === scene.id,
          )!.blockIds
        : [],
    sceneRecord: storyboard.productionRecords?.find(
      (record) => record.kind === "scenes" && record.stableId === scene.id,
    ),
    shots: content.scenes
      .find((item) => item.sceneId === scene.id)!
      .shots.map((shot) => ({
        shotId: shot.id,
        ...(shotAttribution
          ? {
              confirmedShotAttributions: shotAttribution.links.filter(
                (link) => link.sceneId === scene.id && link.shotId === shot.id,
              ),
            }
          : {}),
        sourceBlockIds: shot.sourceBlockIds,
        ...(sourceEvidence
          ? {
              sceneEvidenceIds: sourceEvidence
                .filter((item) => item.sceneId === scene.id)
                .map((item) => item.evidenceId),
              associationScope: "scene",
            }
          : {}),
        record: storyboard.productionRecords?.find(
          (record) => record.kind === "shots" && record.stableId === shot.id,
        ),
      })),
  }));
  const workflowNotice = workflowLineage
    ? "\n\nworkflow-lineage.json 仅附明确所选三正式阶段可核对的原工作流脱敏回执，不含指令、来源正文或候选；缺失原回执保持 unavailable，人工确认不是新模型输入，不补全项目历史或认证语义质量。"
    : "";
  const markdown = `# ${input.manifest.projectTitle} · ${input.manifest.episodeTitle}\n\n仅供内部试制审阅，不是发行就绪证明。媒体二进制不包含；费用未知，未因导出生成媒体。\n\nsource-context.json 分别记录正式大纲、剧本、分镜生成时冻结的实际表达身份、字段与哈希，以及本集章节映射和完整上下文范围；不包含来源正文、摘要正文或提示词。上下文曾被提供不证明模型理解，章节映射／摘要覆盖不证明全文已读，不能由此推定段落到镜头的语义映射。lineage.json 保留已存在的场景、剧本块和镜头关系，不能将全部输入自动归因到每个镜头。\n\n## 采用版本\n\n${Object.entries(
    input.manifest.adopted,
  )
    .flatMap(([key, ref]) => {
      if (!ref) return [];
      if ("id" in ref && "version" in ref)
        return [`- ${key}: ${ref.id} v${ref.version}`];
      return [
        `- 直写路径: ${ref.entryPath === "script" ? "已有剧本" : "作者创意简报"}；没有小说、诊断或季纲版本。`,
        `- 实际项目简报: ${ref.project.id} v${ref.project.version}`,
        `- 实际分集: ${ref.episode.id} v${ref.episode.version}；本集目标 ${ref.durationSeconds} 秒`,
        ...(ref.sourceScript
          ? [
              `- 作者原稿: ${ref.sourceScript.id} v${ref.sourceScript.version}；文档 ${ref.sourceScript.documentVersion === null ? "未创建" : `v${ref.sourceScript.documentVersion}`}`,
            ]
          : []),
      ];
    })
    .join(
      "\n",
    )}\n\n## 预检\n\n${input.manifest.preflight.checks.map((check) => `- ${check.label}: ${check.state} — ${check.detail}`).join("\n")}\n\n## 未完成项\n\n${input.manifest.missingItems.map((item) => `- ${item}`).join("\n")}\n\n## 外部依赖\n\n${input.manifest.externalDependencies.map((item) => `- ${item}`).join("\n")}\n\n## 分镜方案\n\n${content.scenes.map((scene, index) => `### 场景 ${index + 1}\n\n${scene.shots.map((shot) => `镜头 ${shot.orderIndex + 1} · ${shot.durationSeconds} 秒：${shot.visualAction}\n\n构图 ${shot.composition}；机位 ${shot.camera}；运动 ${shot.movement}；声音 ${shot.sound}\n\nPrompt: ${shot.prompt}\n\n负面 Prompt: ${shot.negativePrompt}`).join("\n\n")}`).join("\n\n")}\n`;
  const files = [
    pilotFile(
      "README.md",
      "text/markdown",
      `${markdown}${workflowNotice}\n## 逐场来源证据边界\n\n新协议的 lineage.json 只输出 Production 校验的实际引文哈希、全部 UTF-16 匹配位置和精确来源身份；不附引文、关联理由或来源正文。模型／作者声明的场景关联及其连续剧本块／镜头后代关系不等于逐镜头语义归因；摘要位置只属于实际摘要，不补造原章节位置。历史协议无该证据时不升级。\n`,
    ),
    pilotFile(
      "outline.json",
      "application/json",
      json({
        ...outline.content.value,
        scenes: outline.content.value.scenes.map(
          ({ sourceEvidence: _privateQuotes, ...scene }) => scene,
        ),
      }),
    ),
    pilotFile("script.json", "application/json", json(script.content.value)),
    pilotFile("script.fountain", "text/plain", input.fountain),
    pilotFile("storyboard.json", "application/json", json(content)),
    pilotFile("storyboard.csv", "text/csv", csv),
    pilotFile("assets.json", "application/json", json(content.assets)),
    pilotFile(
      "subtitles.srt",
      "application/x-subrip",
      subtitles
        .map(
          (cue, index) =>
            `${index + 1}\n${timecode(cue.start)} --> ${timecode(cue.end)}\n${cue.text}\n`,
        )
        .join("\n"),
    ),
    pilotFile(
      "media.json",
      "application/json",
      json({
        binaryIncluded: false,
        generatedByExport: false,
        items: [],
        missing:
          "本包不包含媒体二进制；视觉/声音需求见 assets.json，不伪造已锁定或已生成资产。",
      }),
    ),
    pilotFile("lineage.json", "application/json", json(lineage)),
    ...(workflowLineage
      ? [
          pilotFile(
            "workflow-lineage.json",
            "application/json",
            json(workflowLineage),
          ),
        ]
      : []),
    ...(shotAttribution
      ? [
          pilotFile(
            "shot-attributions.json",
            "application/json",
            json(shotAttribution),
          ),
        ]
      : []),
    pilotFile(
      "source-context.json",
      "application/json",
      json(pilotSourceContext([outline, script, storyboard])),
    ),
    pilotFile(
      "creation-records.json",
      "application/json",
      json(
        [outline, script, storyboard].map((value) => ({
          id: value.id,
          version: value.version,
          workflowId: value.workflowId,
          sourceSnapshotId: value.sourceSnapshotId,
          runIds: value.runIds,
          model: value.model,
          adoptedAt: value.adoptedAt,
          ...(value.origin === "human-script-revision"
            ? { origin: value.origin, scriptRevision: value.scriptRevision }
            : value.origin === "human-source-revision"
              ? { origin: value.origin, sourceRevision: value.sourceRevision }
              : value.origin === "human-topology-revision"
                ? {
                    origin: value.origin,
                    topologyRevision: value.topologyRevision,
                  }
                : {}),
          usage:
            value.origin === "human-script-revision" ||
            value.origin === "human-topology-revision" ||
            value.origin === "human-source-revision"
              ? "本次人工确认未调用模型；不推定其他历史运行费用为零"
              : "未包含已核验 token/费用；不能推定为零",
        })),
      ),
    ),
    ...input.nle.map((file) =>
      pilotFile(`nle/${file.fileName}`, file.mimeType, file.content),
    ),
  ];
  const manifest: PilotPackageManifest = {
    ...input.manifest,
    files: files.map(({ content: _content, ...file }) => file),
  };
  files.push(pilotFile("manifest.json", "application/json", json(manifest)));
  return { files, manifest, archive: pilotArchive(files) };
}
