import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "prettier";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");
const repository = join(packageRoot, "../..");
const legacyRoot = join(repository, "legacy/packages/ai/src/prompts");
const loader = await readFile(join(legacyRoot, "loader.ts"), "utf8");

const imported = new Map();
for (const match of loader.matchAll(
  /^import\s+(\w+)\s+from\s+'\.\/(zh-CN\/[^']+\.md)\?raw'$/gm,
))
  imported.set(match[1], match[2]);

const taskSources = new Map();
for (const match of loader.matchAll(
  /^\s{2}([a-z0-9_]+):\s*\{\s*prompt:\s*([^,}]+)/gm,
))
  taskSources.set(match[1], match[2].trim());

const entries = [];
for (const [taskType, source] of taskSources) {
  if (source.startsWith("'")) {
    entries.push([taskType, source.slice(1, -1)]);
    continue;
  }
  const relativePath = imported.get(source);
  if (!relativePath)
    throw new Error(`无法定位旧版 Prompt：${taskType} -> ${source}`);
  entries.push([
    taskType,
    await readFile(join(legacyRoot, relativePath), "utf8"),
  ]);
}
entries.push([
  "chapter_diagnostic",
  "请诊断章节的人物动机、叙事节奏、冲突、钩子、连续性和短剧适配度，并给出可执行建议。",
]);
entries.push([
  "chapter_revision",
  "请在保持人物设定与核心情节的前提下提出章节修订稿。只返回变更预览，不得直接写入正式内容。",
]);
entries.sort(([left], [right]) => left.localeCompare(right));

const lines = [
  "/* 由 legacy/packages/ai 的已确认中文 Prompt 生成；请勿直接编辑。 */",
  'import type { AgentTaskType } from "@sdns/schema";',
  "",
  "export const LEGACY_PROMPT_CATALOG: Readonly<Partial<Record<AgentTaskType, string>>> = {",
  ...entries.map(
    ([taskType, prompt]) =>
      `  ${JSON.stringify(taskType)}: ${JSON.stringify(prompt)},`,
  ),
  "};",
  "",
  "export function getLegacyPrompt(taskType: AgentTaskType): string {",
  '  return LEGACY_PROMPT_CATALOG[taskType] ?? "请根据统一任务定义完成本次中文创作任务。";',
  "}",
  "",
];
const outputPath = join(packageRoot, "src/prompt-catalog.generated.ts");
const generated = await format(`${lines.join("\n")}\n`, {
  parser: "typescript",
});
if (process.argv.includes("--check")) {
  const current = await readFile(outputPath, "utf8").catch(() => "");
  if (current !== generated) {
    process.stderr.write(
      "LangGraph.js Prompt 目录已过期，请运行 bun run --filter @sdns/ai-legacy generate:prompts\n",
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(`已核验 ${entries.length} 份旧版中文 Prompt\n`);
  }
} else {
  await writeFile(outputPath, generated);
  process.stdout.write(`已迁移 ${entries.length} 份旧版中文 Prompt\n`);
}
