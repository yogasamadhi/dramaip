import { NativeSelect } from "@dramaip/ui-shared";
import type { z } from "zod";
import type {
  TimelineRendererFontDescriptorSchema,
  TimelineRenderSubtitlePolicy,
} from "@dramaip/contracts/timeline";
import { TimelineRendererFontRefSchema } from "@dramaip/contracts/timeline";
import type {
  RenderFontRef,
  RenderSubtitleMode,
} from "../../timeline-render-subtitle-selection";
type Font = z.infer<typeof TimelineRendererFontDescriptorSchema>;
const ref = (font: RenderFontRef): RenderFontRef => ({
  id: font.id,
  packVersion: font.packVersion,
  sha256: font.sha256,
});
export function TimelineRenderSubtitleControls(props: {
  mode?: RenderSubtitleMode;
  font?: RenderFontRef;
  fonts?: readonly Font[];
  available?: boolean;
  disabled: boolean;
  onMode: (mode: RenderSubtitleMode | undefined) => void;
  onFont: (font: RenderFontRef | undefined) => void;
}) {
  const selected = props.font ? JSON.stringify(ref(props.font)) : "";
  const selectedMetadata = props.fonts?.find(
    (font) => JSON.stringify(ref(font)) === selected,
  );
  return (
    <div
      className="space-y-2 rounded border border-line p-3 text-xs"
      data-testid="timeline-render-subtitle-controls"
    >
      <label className="block">
        字幕输出策略
        <NativeSelect
          aria-label="字幕输出策略"
          className="ml-2 w-auto"
          value={props.mode ?? ""}
          disabled={props.disabled}
          onChange={(event) =>
            props.onMode(
              event.target.value === "omit" || event.target.value === "burn-in"
                ? event.target.value
                : undefined,
            )
          }
        >
          <option value="">尚未选择，不创建任务</option>
          <option value="omit">明确不烧录字幕</option>
          <option value="burn-in" disabled={!props.available}>
            烧录原字幕与指定字体
          </option>
        </NativeSelect>
      </label>
      <p>
        {props.available === undefined
          ? "先明确核对实际来源与渲染能力，读取字体目录；不会自动选择字体。"
          : props.available
            ? "原字体已通过签名与实际绘制验证，仍不证明发行授权或排版质量。"
            : "当前没有已验证的签名字体能力；可明确不烧录字幕，不能回退系统字体。"}
      </p>
      {props.mode === "burn-in" && (
        <>
          <label className="block">
            原字体身份
            <NativeSelect
              aria-label="烧录字幕字体"
              className="ml-2 max-w-full w-auto"
              value={selected}
              disabled={props.disabled}
              onChange={(event) =>
                props.onFont(
                  event.target.value
                    ? TimelineRendererFontRefSchema.parse(
                        JSON.parse(event.target.value),
                      )
                    : undefined,
                )
              }
            >
              <option value="">请选择原字体，不自动选第一项</option>
              {selected && !selectedMetadata && (
                <option value={selected}>
                  原字体当前不可用，须重新核对；不会自动换源
                </option>
              )}
              {props.fonts?.map((font) => (
                <option key={font.id} value={JSON.stringify(ref(font))}>
                  {font.label} · {font.packVersion} · {font.sha256.slice(0, 12)}
                </option>
              ))}
            </NativeSelect>
          </label>
          {props.font && (
            <p className="break-all">
              原字体 {props.font.id} · v{props.font.packVersion} · SHA{" "}
              {props.font.sha256}
            </p>
          )}
          {selectedMetadata && (
            <p className="whitespace-pre-wrap break-words">
              签名许可声明（不是授权核验）：{selectedMetadata.license}
              ；原来源声明：{selectedMetadata.sourceUrl}
            </p>
          )}
          <p>
            只烧录当前未muted的完整原字幕；缺字、重叠、超区或字体失效将拒绝，不换字体、缩字、折行或丢字幕。
          </p>
        </>
      )}
    </div>
  );
}
export function TimelineRenderSubtitlePolicyView({
  policy,
}: {
  policy?: TimelineRenderSubtitlePolicy;
}) {
  return (
    <p className="break-all" data-testid="timeline-render-subtitle-policy">
      {!policy
        ? "原字幕策略：历史未记录／旧不烧录，不补成新选择。"
        : policy.mode === "omit"
          ? "原字幕策略：明确不烧录字幕（v1）；独立SRT另行导出。"
          : `原字幕策略：烧录完整原字幕（v1） · 字体 ${policy.font.id} · v${policy.font.packVersion} · SHA ${policy.font.sha256}`}
    </p>
  );
}
