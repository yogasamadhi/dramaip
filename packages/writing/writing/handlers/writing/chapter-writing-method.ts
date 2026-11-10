import type { NarrativeContextBasis } from "@dramaip/contracts/creation";

/**
 * Craft guidance for writing a novel chapter. It is generic web-novel craft
 * that also leaves the text easy to adapt later; it never asks the model to
 * turn the novel into a script.
 */
export const CHAPTER_WRITING_METHOD = [
  "写作方法（在内部完成构思，只输出正文）：",
  "1. 承接：从上一章结尾的时间、地点、人物状态和未解问题接着写；不复述前情，不重新介绍已出场的人物。",
  "2. 本章任务：想清本章推进哪条线、主要人物想要什么、遇到什么阻力、付出什么代价、结尾停在哪里。",
  "3. 开篇：直接进入场景、动作或对白，前三段内让读者看到本章的矛盾或悬念；不用环境套话或回顾开场。",
  "4. 场景：用场景推进剧情，每个场景都有目标、阻碍和结果；用动作、对白和具体细节展示人物，少用心理总结和旁白式概括。",
  "5. 对白：符合人物身份和性格，有信息、有冲突；不说空话，不让人物替作者解释设定。",
  "6. 一致性：人物性格、关系、称呼、能力、时间线和设定与前文一致；每个人物只知道自己此时应该知道的事。",
  "7. 结尾：停在新的问题、威胁、选择或转折上，让读者想看下一章；不总结、不感慨、不说教、不预告。",
  "8. 语言：遵循作者意图与文风；具体胜过华丽，删掉“不禁”“仿佛”“一丝”“嘴角勾起”这类套话和堆砌的形容词；不强求每章反转。",
  "用户要求优先：如果要求是续写、改写、润色、扩写或只改选段，保留要求中说明要保留的内容，只在相应范围内运用以上方法。",
  "输出：content 只放完整小说正文，不加章节号、标题或任何说明；title 为章名；items 为空。",
].join("\n");

/**
 * One short note telling the model how to treat the prior text it was given.
 * Facts beat summaries, plans are not events, and missing chapters are not to
 * be invented.
 */
export function novelContextNote(basis: NarrativeContextBasis): string {
  const originals = basis.chapters.filter(
    (chapter) => chapter.representation !== "summary",
  ).length;
  const summaries = basis.chapters.filter(
    (chapter) => chapter.representation === "summary",
  ).length;
  const higher = basis.summaries?.length ?? 0;
  const missing = basis.omitted.filter(
    (chapter) => chapter.reason === "not-selected",
  ).length;
  const provided =
    originals || summaries || higher
      ? `本次提供前文原文 ${originals} 章、章节摘要 ${summaries} 章${higher ? `、阶段摘要 ${higher} 条` : ""}。`
      : "本次没有前文资料，以项目设定、人物与大纲为准。";
  return [
    "参考资料说明：本章当前正文和前文原文是已经发生的事实，必须严格承接、不得矛盾；摘要是概括，细节以原文为准；人物、大纲和故事弧是计划，可按本章需要推进，不当作已经发生。",
    provided +
      (missing
        ? `另有 ${missing} 章前文未提供，不要编造其中的细节。`
        : ""),
  ].join("\n");
}
