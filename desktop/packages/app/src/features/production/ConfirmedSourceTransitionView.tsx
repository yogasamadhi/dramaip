import type { EpisodeDevelopmentImpact } from "@dramaip/contracts/production";

export function ConfirmedSourceTransitionView({
  value,
}: {
  value: EpisodeDevelopmentImpact["confirmedSourceTransition"];
}) {
  if (!value) return null;
  return (
    <details
      aria-label="本次实际来源确认链"
      className="space-y-2 rounded border border-line p-3 text-sm"
    >
      <summary>实际新来源已正式确认，仍须独立审阅全部镜头</summary>
      <p>
        当前正式父链、原采用预览、同一保存稿件和原上下文已核对。原分镜仍保留旧来源，不自动改为当前稿。
      </p>
      <p className="break-all">
        原大纲 {value.originalOutline.id} v{value.originalOutline.version} →
        当前大纲 {value.currentOutline.id} v{value.currentOutline.version}
      </p>
      <p className="break-all">
        原剧本 {value.originalScript.id} v{value.originalScript.version} →
        当前剧本 {value.currentScript.id} v{value.currentScript.version}
      </p>
      <p className="break-all">
        同一稿件 {value.document.id} · 实际剧本 {value.document.scriptId} · 文档
        v{value.document.version} · SHA-256 {value.document.contentHash}
      </p>
      {value.confirmationPreviews.map((preview) => (
        <p key={preview.id} className="break-all">
          实际已采用来源确认 {preview.id} v{preview.version}
        </p>
      ))}
      <p>
        未观察到机械变化不等于语义安全；原关联、本次完整观察、全部实际镜头决定和五项审阅仍须明确确认。未知范围继续拒绝，不自动选镜头、重做或切换来源。
      </p>
    </details>
  );
}
