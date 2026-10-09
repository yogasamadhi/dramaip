import type {
  StoryboardAttributionImpact,
  StoryboardAttributionImpactReason,
} from "@dramaip/contracts/production";

const labels: Record<StoryboardAttributionImpactReason, string> = {
  "original-source-unverified": "原冻结表达本次未核全，不能补造引文证明",
  "source-read-unavailable": "原来源 owner 本次读取失败",
  "source-missing": "原来源或明确稳定块缺失",
  "source-expression-unverified": "当前表达资格未核全，不代替为新来源",
  "source-version-changed": "原来源实际版本变化",
  "quote-position-changed": "原明确位置的逐字内容变化，不搜索新位置",
  "source-block-missing": "原稿中明确引用的稳定块缺失",
  "source-block-reordered": "原稿中的同一稳定块顺序变化",
  "source-block-type-changed": "原稿稳定块不再是动作／对白表达",
  "source-paragraph-missing": "原段落身份不在当前索引，不自动改连其他段落",
  "source-paragraph-position-changed": "原段落实际位置变化",
  "script-block-unavailable": "正式剧本稳定块本次未核全",
  "script-block-missing": "明确关联的正式稳定块缺失",
  "script-block-changed": "明确关联的正式稳定块字节变化",
  "script-block-reordered": "明确关联的正式稳定块顺序变化",
  "scene-record-unavailable": "原场景记录本次未核全",
  "scene-record-missing": "原场景记录缺失",
  "scene-record-changed": "原场景实际版本／字段变化",
  "scene-record-retired": "原场景记录已明确退役",
  "shot-record-unavailable": "原镜头记录本次未核全",
  "shot-record-missing": "原镜头记录缺失",
  "shot-record-changed": "原镜头实际版本／字段变化",
  "shot-record-retired": "原镜头记录已明确退役",
  "story-node-unavailable": "原节点 owner 本次读取失败，不用缓存或替代节点",
  "story-node-reference-changed": "原节点引用与关联冻结指纹不同或已不合资格",
  "declaration-missing": "原节点声明缺失",
  "declaration-not-adopted": "原节点声明并非实际已采用",
  "declaration-version-changed": "原节点声明版本变化",
  "declaration-node-binding-changed": "原声明与原节点版本绑定不同",
  "node-missing": "原节点记录缺失",
  "node-version-changed": "原节点记录版本变化",
  "node-fields-changed": "原节点实际字段变化，包含同版本漂移",
  "node-unconfirmed": "原节点已不处于明确确认状态",
  "node-retired": "原节点已退役，旧关联不自动改连",
  "node-lifecycle-withdrawn": "原节点采用已明确撤回",
  "node-lifecycle-replaced": "原节点采用已明确替换，仍观察原节点",
  "declaration-source-stale": "原节点声明自己的来源已变化",
  "declaration-source-unavailable": "原节点声明自己的来源本次未核全",
};
const comparisonLabels = {
  "same-position-match": "原明确位置逐字一致（不是语义安全）",
  "position-changed": "原明确位置的逐字内容已变化",
  missing: "原来源／稳定块缺失",
  unavailable: "本次来源读取失败",
  unverified: "原冻结或当前表达未核全",
};
export function StoryboardAttributionImpactView({
  value,
}: {
  value: StoryboardAttributionImpact;
}) {
  return (
    <section
      aria-label="原人工关联逐链接影响"
      className="space-y-2 rounded border border-line p-3"
    >
      <h4 className="font-medium">原人工关联逐链接影响</h4>
      <p className="break-all">
        原关联 {value.attribution.id} · v{value.attribution.version} ·{" "}
        {value.isCurrent ? "当前采用" : "历史采用，不能自动用于当前重做"}
      </p>
      <p className="text-muted">
        无正文／引文／私人理由。只观察原位置和实际 owner
        元数据，不搜索新位置、不跟随替代节点；文学语义未核验，也不解除来源门或自动重做。
      </p>
      <p>
        原关联覆盖 {value.coverage.associatedShots}/{value.coverage.totalShots}{" "}
        个镜头，其中 {value.coverage.nodeAssociatedShots}{" "}
        个明确关联故事节点；未关联范围保留。
      </p>
      {value.links.map((link) => (
        <details key={link.index} className="rounded border border-line p-2">
          <summary className="break-all">
            链接 {link.index + 1} · 场景 {link.original.sceneId} · 镜头{" "}
            {link.original.shotId}：
            {link.associationImpact === "affected"
              ? "已观察到关联变化，需复核"
              : link.associationImpact === "unresolved"
                ? "本次未核全，不能确认"
                : "未观察到关联变化，不证明语义安全"}
          </summary>
          <div className="mt-2 space-y-2">
            <p className="break-all">
              原引文 {link.original.evidenceId} · 明确匹配位置{" "}
              {link.original.matchIndex + 1} · UTF-16 [
              {link.original.evidence.match.start},{" "}
              {link.original.evidence.match.end})；
              {comparisonLabels[link.quote.comparison]}
            </p>
            {link.original.evidence.match.chapterStart !== undefined && (
              <p>
                原章节位置 [{link.original.evidence.match.chapterStart},{" "}
                {link.original.evidence.match.chapterEnd})；不自动重新定位。
              </p>
            )}
            {link.original.evidence.source.sourceKind === "knowledge" && (
              <p className="text-muted">
                这是已采用摘要／事实的表达位置，不是原小说正文位置。
              </p>
            )}
            <p className="break-all">
              原来源 {link.original.evidence.source.sourceId} · v
              {link.original.evidence.source.sourceVersion} → 本次实际 v
              {link.quote.currentSourceVersion ?? "未核全／缺失"}
            </p>
            {link.quote.sourceBlock && (
              <p className="break-all">
                原稿同一稳定块 {link.quote.sourceBlock.id} · 当前序号{" "}
                {link.quote.sourceBlock.index + 1} ·{" "}
                {link.quote.sourceBlock.type}
              </p>
            )}
            {link.quote.paragraph && (
              <p className="break-all">
                原段落 {link.quote.paragraph.id} ·{" "}
                {link.quote.paragraph.present
                  ? `本次位置 [${link.quote.paragraph.start}, ${link.quote.paragraph.end})`
                  : "原身份不在当前索引"}
              </p>
            )}
            {link.blocks.map((block) => (
              <p key={block.id} className="break-all">
                正式稳定块 {block.id} ·{" "}
                {block.change === "same-reference"
                  ? "字节／顺序未观察变化"
                  : block.change === "changed"
                    ? "字节变化"
                    : block.change === "reordered"
                      ? "顺序变化"
                      : block.change === "missing"
                        ? "原块缺失"
                        : "本次未核全"}
              </p>
            ))}
            {(["scene", "shot"] as const).map((kind) => (
              <p key={kind} className="break-all">
                {kind === "scene" ? "原场景" : "原镜头"}记录{" "}
                {link.records[kind].frozen.id} · 冻结 v
                {link.records[kind].frozen.version} → 实际 v
                {link.records[kind].current?.version ?? "未核全／缺失"}
                {link.records[kind].current?.retired ? " · 已退役" : ""}
              </p>
            ))}
            {link.original.storyNode ? (
              <div className="space-y-1">
                <p className="break-all">
                  原节点 {link.original.storyNode.node.id} · v
                  {link.original.storyNode.node.version}；原声明{" "}
                  {link.original.storyNode.declaration.id} · v
                  {link.original.storyNode.declaration.version}
                </p>
                <p>
                  本次节点观察：
                  {link.node?.readState === "available"
                    ? `实际 v${link.node.observation?.node?.version ?? "缺失"} · ${link.node.observation?.lifecycle?.state ?? "生命周期未核全"}`
                    : "读取失败，不能沿用旧缓存"}
                </p>
                {link.node?.observation?.lifecycle?.replacementId && (
                  <p className="break-all">
                    替换声明 {link.node.observation.lifecycle.replacementId}
                    （仅生命周期元数据，不是此链接的新节点绑定）。
                  </p>
                )}
              </div>
            ) : (
              <p className="text-muted">原链接未选择故事节点，不自动添加。</p>
            )}
            {link.reasonCodes.map((code) => (
              <p key={code} className="text-danger-strong">
                {labels[code]}
              </p>
            ))}
          </div>
        </details>
      ))}
      {value.coverage.unassociatedShotIds.length > 0 && (
        <details>
          <summary>原未关联镜头（不补造覆盖）</summary>
          <p className="break-all">
            {value.coverage.unassociatedShotIds.join("、")}
          </p>
        </details>
      )}
    </section>
  );
}
