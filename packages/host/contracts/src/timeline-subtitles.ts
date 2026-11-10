export interface HostRendererFontRef {
  id: string;
  packVersion: string;
  sha256: string;
}
export interface HostRendererFontDescriptor extends HostRendererFontRef {
  label: string;
  sizeBytes: number;
  /** Signed declarations, not proof of distribution rights. */
  license: string;
  sourceUrl: string;
}
export interface HostTimelineRenderSubtitleCue {
  clipId: string;
  startFrame: number;
  durationFrames: number;
  text: string;
}
export type HostTimelineRenderSubtitlePlan =
  | { format: "dramaip-render-subtitles"; version: 1; mode: "omit" }
  | {
      format: "dramaip-render-subtitles";
      version: 1;
      mode: "burn-in";
      font: HostRendererFontRef;
      cues: readonly HostTimelineRenderSubtitleCue[];
    };
export const HOST_MAX_RENDER_SUBTITLE_CUES = 256;
const object = (v: unknown): v is Record<string, unknown> =>
  Boolean(v && typeof v === "object" && !Array.isArray(v));
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const keys = (v: Record<string, unknown>, expected: string) =>
  Object.keys(v).sort().join(",") === expected;
export function validRendererFontRef(v: unknown): v is HostRendererFontRef {
  return (
    object(v) &&
    keys(v, "id,packVersion,sha256") &&
    typeof v.id === "string" &&
    uuid.test(v.id) &&
    typeof v.packVersion === "string" &&
    v.packVersion.length <= 120 &&
    /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/u.test(v.packVersion) &&
    typeof v.sha256 === "string" &&
    /^[a-f0-9]{64}$/u.test(v.sha256)
  );
}
/** Validate raw text and frame data before it can become process arguments. Never coerce or truncate. */
export function validTimelineRenderSubtitlePlan(
  v: unknown,
  durationFrames: number,
): v is HostTimelineRenderSubtitlePlan {
  if (
    !object(v) ||
    v.format !== "dramaip-render-subtitles" ||
    v.version !== 1 ||
    !Number.isSafeInteger(durationFrames) ||
    durationFrames < 1 ||
    durationFrames > 1_000_000
  )
    return false;
  if (v.mode === "omit") return keys(v, "format,mode,version");
  if (
    v.mode !== "burn-in" ||
    !keys(v, "cues,font,format,mode,version") ||
    !validRendererFontRef(v.font) ||
    !Array.isArray(v.cues) ||
    !v.cues.length ||
    v.cues.length > HOST_MAX_RENDER_SUBTITLE_CUES
  )
    return false;
  const ids = new Set<string>();
  let bytes = 0;
  const ranges: { start: number; end: number }[] = [];
  for (const cue of v.cues) {
    if (
      !object(cue) ||
      !keys(cue, "clipId,durationFrames,startFrame,text") ||
      typeof cue.clipId !== "string" ||
      !uuid.test(cue.clipId) ||
      ids.has(cue.clipId) ||
      typeof cue.startFrame !== "number" ||
      !Number.isSafeInteger(cue.startFrame) ||
      cue.startFrame < 0 ||
      typeof cue.durationFrames !== "number" ||
      !Number.isSafeInteger(cue.durationFrames) ||
      cue.durationFrames < 1 ||
      !Number.isSafeInteger(cue.startFrame + cue.durationFrames) ||
      cue.startFrame + cue.durationFrames > durationFrames ||
      typeof cue.text !== "string" ||
      !cue.text.trim() ||
      Buffer.byteLength(cue.text, "utf8") > 16 * 1024
    )
      return false;
    for (const char of cue.text) {
      const cp = char.codePointAt(0)!;
      if (
        (cp >= 0xd800 && cp <= 0xdfff) ||
        (cp < 32 && cp !== 10) ||
        cp === 127
      )
        return false;
    }
    bytes += Buffer.byteLength(cue.text, "utf8");
    if (bytes > 1024 * 1024) return false;
    ids.add(cue.clipId);
    ranges.push({
      start: cue.startFrame,
      end: cue.startFrame + cue.durationFrames,
    });
  }
  ranges.sort((a, b) => a.start - b.start);
  return ranges.every(
    (range, index) => !index || range.start >= ranges[index - 1]!.end,
  );
}
