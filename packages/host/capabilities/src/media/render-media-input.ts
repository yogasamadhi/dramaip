import { extname, isAbsolute } from "node:path";

/** Only Host-owned staged files, an exact known demuxer and no nested/network protocols. */
export function renderMediaInputOptions(path: string): string[] {
  if (!isAbsolute(path))
    throw new Error(
      "A private render input must be an absolute Host-owned file",
    );
  const formats: Readonly<Record<string, string>> = {
    ".mp4": "mov",
    ".m4a": "mov",
    ".wav": "wav",
    ".mp3": "mp3",
    ".ogg": "ogg",
    ".aac": "aac",
    ".flac": "flac",
  };
  const format = formats[extname(path)];
  if (!format)
    throw new Error("A private render input has no supported exact container");
  return [
    "-protocol_whitelist",
    "file",
    "-f",
    format,
    ...(format === "mov"
      ? ["-enable_drefs", "0", "-use_absolute_path", "0"]
      : []),
  ];
}
