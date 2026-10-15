import type { StoryboardSourceReviewReceipt } from "@dramaip/contracts/production";
export function StoryboardSourceReviewReceiptView({
  value,
}: {
  value: StoryboardSourceReviewReceipt;
}) {
  return (
    <details
      aria-label="冻结完整来源审阅"
      className="space-y-2 rounded border border-line p-3 text-sm"
    >
      <summary>原关联与全部镜头的参考内容审阅（语义未认证）</summary>
      <p className="break-all">
        原分镜 {value.storyboard.id} · v{value.storyboard.version} · 原关联{" "}
        {value.review.attribution.id} · v{value.review.attribution.version}
      </p>
      <p className="break-all">
        原观察 {value.review.impactHash} · 完整观察内容指纹{" "}
        {value.impactContentHash} · 完整范围 {value.scopeHash}
      </p>
      <p>
        原请求的五项独立审阅已明确确认；这不是模型理解、独立质量结论或来源资格豁免，不自动改连节点或引文。
      </p>
      {value.review.shots.map((shot) => (
        <p key={shot.shotId} className="break-all">
          场景 {shot.sceneId} · 镜头 {shot.shotId} · 实际 {shot.record.id} v
          {shot.record.version} ·{" "}
          {shot.observedState === "unassociated"
            ? "未关联（不是未变化）"
            : shot.observedState === "affected"
              ? "机械受影响"
              : shot.observedState === "unresolved"
                ? "范围未核全"
                : "未观察到关联变化（不是语义安全）"}{" "}
          · 明确{shot.decision === "redo" ? "重做" : "保留"}
        </p>
      ))}
    </details>
  );
}
