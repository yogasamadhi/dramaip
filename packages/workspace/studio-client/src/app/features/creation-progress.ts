/** Read displayable strings from an unfinished structured response without showing JSON. */
export function creationStreamPreview(raw: string, checking = false): string {
  const source = raw.trimStart().replace(/^```(?:json)?\s*/, "");
  if (!source.startsWith("{")) return "";
  const fields: Array<{ key: string; value: string; depth: number }> = [];
  let depth = 0;
  let key: string | undefined;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === "{" || char === "[") {
      depth++;
      continue;
    }
    if (char === "}" || char === "]") {
      depth--;
      continue;
    }
    if (char === ",") {
      key = undefined;
      continue;
    }
    if (char !== '"') continue;
    let value = "";
    let closed = false;
    for (i++; i < source.length; i++) {
      const next = source[i]!;
      if (next === '"') {
        closed = true;
        break;
      }
      if (next !== "\\") {
        value += next;
        continue;
      }
      const escape = source[++i];
      if (!escape) break;
      if (escape === "u") {
        const hex = source.slice(i + 1, i + 5);
        if (!/^[0-9a-f]{4}$/i.test(hex)) break;
        value += String.fromCharCode(parseInt(hex, 16));
        i += 4;
      } else {
        value +=
          (
            {
              n: "\n",
              r: "\r",
              t: "\t",
              b: "\b",
              f: "\f",
              '"': '"',
              "\\": "\\",
              "/": "/",
            } as Record<string, string>
          )[escape] ?? "";
      }
    }
    // Do not flash an incomplete surrogate while a Unicode escape is arriving.
    value = value.replace(/[\uD800-\uDBFF]$/, "");
    if (
      closed &&
      source
        .slice(i + 1)
        .trimStart()
        .startsWith(":")
    )
      key = value;
    else if (key) {
      fields.push({ key, value, depth });
      key = undefined;
    }
  }
  if (checking)
    return fields
      .filter((field) => field.key === "message")
      .map((field) => field.value)
      .filter(Boolean)
      .join("\n");
  const content = fields.find(
    (field) => field.depth === 1 && field.key === "content",
  )?.value;
  return (
    content ||
    fields
      .filter(
        (field) => field.depth === 1 && ["title", "brief"].includes(field.key),
      )
      .map((field) => field.value)
      .filter(Boolean)
      .join("\n\n")
  );
}

export function creationElapsed(start: string, end: number): string {
  const seconds =
    Math.max(0, Math.floor((end - Date.parse(start)) / 1000)) || 0;
  return seconds < 60
    ? `${seconds} 秒`
    : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}
