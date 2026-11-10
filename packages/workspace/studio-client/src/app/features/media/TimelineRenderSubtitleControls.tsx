import { NativeSelect } from "@dramaip/infra-ui-primitives";
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
import styles from "./TimelineRenderSubtitleControls.module.css";
import { copyText } from "../../copy";
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
    <div className={styles.c1} data-testid="timeline-render-subtitle-controls">
      <label className={styles.c2}>
        {copyText("app/features/media/TimelineRenderSubtitleControls.1")}
        <NativeSelect
          aria-label={copyText(
            "app/features/media/TimelineRenderSubtitleControls.1",
          )}
          className={styles.c3}
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
          <option value="">
            {copyText("app/features/media/TimelineRenderSubtitleControls.2")}
          </option>
          <option value="omit">
            {copyText("app/features/media/TimelineRenderSubtitleControls.3")}
          </option>
          <option value="burn-in" disabled={!props.available}>
            {copyText("app/features/media/TimelineRenderSubtitleControls.4")}
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
          <label className={styles.c2}>
            {copyText("app/features/media/TimelineRenderSubtitleControls.5")}
            <NativeSelect
              aria-label={copyText(
                "app/features/media/TimelineRenderSubtitleControls.6",
              )}
              className={styles.c4}
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
              <option value="">
                {copyText(
                  "app/features/media/TimelineRenderSubtitleControls.7",
                )}
              </option>
              {selected && !selectedMetadata && (
                <option value={selected}>
                  {copyText(
                    "app/features/media/TimelineRenderSubtitleControls.8",
                  )}
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
            <p className={styles.c5}>
              {copyText("app/features/media/TimelineRenderSubtitleControls.9")}
              {props.font.id}
              {copyText("app/features/media/TimelineRenderSubtitleControls.10")}
              {props.font.packVersion}
              {copyText(
                "app/features/media/TimelineRenderSubtitleControls.11",
              )}{" "}
              {props.font.sha256}
            </p>
          )}
          {selectedMetadata && (
            <p className={styles.c6}>
              {copyText("app/features/media/TimelineRenderSubtitleControls.12")}
              {selectedMetadata.license}
              {copyText("app/features/media/TimelineRenderSubtitleControls.13")}
              {selectedMetadata.sourceUrl}
            </p>
          )}
          <p>
            {copyText("app/features/media/TimelineRenderSubtitleControls.14")}
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
    <p className={styles.c5} data-testid="timeline-render-subtitle-policy">
      {!policy
        ? "原字幕策略：历史未记录／旧不烧录，不补成新选择。"
        : policy.mode === "omit"
          ? "原字幕策略：明确不烧录字幕（v1）；独立SRT另行导出。"
          : `原字幕策略：烧录完整原字幕（v1） · 字体 ${policy.font.id} · v${policy.font.packVersion} · SHA ${policy.font.sha256}`}
    </p>
  );
}
