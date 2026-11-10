import { createHash } from "node:crypto";
import {
  CreationContentSchema,
  CreationModelCheckSchema,
  type CreationContent,
  type CreationIssue,
  type CreationOperation,
} from "@dramaip/contracts/creation";

export const CREATION_CHECK_PROMPT =
  '审阅候选与冻结的创作目标和来源。核对人物认知、时序、事实、剧情推进、对白、重复和任务约束。仅报告有本轮候选原文证据的问题，不打综合分。evidence 必须逐字引用本轮候选中的非空文字，不能引用指令、来源或旧候选代替；位置和局部修改建议须非空。只返回 JSON：{"issues":[{"severity":"error 或 warning 或 suggestion","message":"问题","evidence":"候选中的原文证据","location":"章节/场景/段落或候选字段","suggestion":"局部修改要求","source":"model"}]}。无问题时 issues 为空数组。引文存在不等于推断正确；来源不足不伪称已读全书。';

const gateFocus: Partial<Record<CreationOperation, string>> = {
  chapter:
    "小说章节采用前：对照正式作者意图、文风/叙述视角、人物认知、因果、重复、字数目标和冻结来源；严重设定矛盾报 error。不把未短剧化、未做分镜或视频当作小说错误。",
  "adaptation-diagnosis":
    "改编诊断采用前：核实际来源范围、主题、人物弧、关键情节与权利声明；严重覆盖不足或主线判断没有实际来源报 error。未读范围不得假称已覆盖；不替作者选择策略。",
  "adaptation-strategy":
    "改编策略采用前：核所选正式诊断、作者意图、保留/可改/禁改、人物动机和因果；严重冲突报 error，不把建议当作已发生事实。",
  "season-plan":
    "整季方案采用前：核集间重复、明确遗漏、人物推进、伏笔、钩子与结尾悬念；主线缺失或关键人物弧断裂报 error，允许有理由且明确标注的删减。",
  "episode-outline":
    "单集大纲采用前：核正式季纲和本集实际来源、人物行动、因果、场景推进和集尾，不借其他集或未读原文补事实；严重连续性或结构错误报 error。",
  "episode-script":
    "剧本采用前：核人物认知、因果、对白、场景推进、目标时长和集尾；严重连续性或结构错误报 error。时长是文本估算，不是实际成片时长。",
  "script-revision":
    "剧本修订采用前：核人物认知、因果、对白、场景推进、目标时长和集尾，保留稳定块及明确修订边界；严重连续性或结构错误报 error。",
  episode:
    "兼容剧本采用前：核人物认知、因果、对白、场景推进、目标时长和集尾；严重连续性或结构错误报 error。不把未明确选择的小说当来源。",
  "storyboard-package":
    "分镜采用前：核实际剧本/块覆盖、角色和场景引用、动作可视化、权利声明与成本风险；严重剧本覆盖不足或权利冲突报 error。风险不是报价，也不保证能拍。",
};

export function creationQualityPrompt(operation: CreationOperation): string {
  return `${CREATION_CHECK_PROMPT}\n${gateFocus[operation] ?? "对照该操作实际冻结的目标、范围和任务约束；不把规划、推断或未知值当作正式事实。"}`;
}

type TextField = { valuePath: string; text: string };
function candidateTextFields(candidate: CreationContent): TextField[] {
  const fields: TextField[] = [];
  let visited = 0;
  const visit = (value: unknown, valuePath: string, depth = 0) => {
    if (++visited > 100_000 || depth > 64 || valuePath.length > 4096)
      throw new Error("创作检查候选结构超出可核对范围；不截断后放行。");
    if (typeof value === "string") fields.push({ valuePath, text: value });
    else if (Array.isArray(value))
      value.forEach((entry, index) =>
        visit(entry, `${valuePath}/${index}`, depth + 1),
      );
    else if (value && typeof value === "object")
      for (const [key, entry] of Object.entries(value))
        visit(
          entry,
          `${valuePath}/${key.replace(/~/gu, "~0").replace(/\//gu, "~1")}`,
          depth + 1,
        );
  };
  visit(candidate.title, "/title");
  visit(candidate.brief, "/brief");
  visit(candidate.content, "/content");
  candidate.items.forEach((item, index) => {
    visit(item.title, `/items/${index}/title`);
    visit(item.data, `/items/${index}/data`);
  });
  return fields;
}

/** Literal integrity for the exact current candidate, not semantic certification. */
export function collectCreationIssues(
  raw: string,
  rules: CreationIssue[],
  candidate: CreationContent,
): CreationIssue[] {
  let result;
  try {
    const text =
      raw.match(/^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/u)?.[1] ?? raw;
    result = CreationModelCheckSchema.parse(JSON.parse(text));
  } catch {
    throw new Error(
      "创作检查结果无效：每项问题须有非空证据、位置、问题和可执行建议；不把无效检查当通过。",
    );
  }
  if (!result.issues.length) return [...rules];
  const parsed = CreationContentSchema.parse(candidate);
  const fields = candidateTextFields(parsed);
  const candidateSha256 = createHash("sha256")
    .update(JSON.stringify(parsed))
    .digest("hex");
  const issues = result.issues.map((issue): CreationIssue => {
    const matches: Array<{ valuePath: string; start: number; end: number }> =
      [];
    for (const field of fields) {
      let start = field.text.indexOf(issue.evidence);
      while (start >= 0) {
        matches.push({
          valuePath: field.valuePath,
          start,
          end: start + issue.evidence.length,
        });
        if (matches.length > 100)
          throw new Error(
            "创作检查引文匹配过多，无法明确核对位置；请引用更具体的候选文字。",
          );
        // Preserve all exact, including overlapping, matches. Never guess the
        // first occurrence or infer an anchor from the model's location label.
        start = field.text.indexOf(issue.evidence, start + 1);
      }
    }
    if (!matches.length)
      throw new Error("创作检查引文不在本轮候选中；候选保留，检查未通过。");
    return {
      ...issue,
      source: "model",
      candidateEvidence: { candidateSha256, matches },
    };
  });
  return [...rules, ...issues];
}
