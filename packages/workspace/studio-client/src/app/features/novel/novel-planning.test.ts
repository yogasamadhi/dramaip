import { describe, expect, it } from "vitest";
import type { DomainEntity } from "@dramaip/contracts/product";
import {
  PLANNING_STEPS,
  nextPlanningStep,
  planningInstruction,
  storySetupInstruction,
  planningProgress,
} from "./novel-planning";

const entity = (payload: Record<string, unknown>) =>
  ({ id: "x", title: "条目", payload }) as unknown as DomainEntity;

describe("小说构思进度", () => {
  it("按设定、人物、全书大纲的顺序找下一步", () => {
    const empty = planningProgress({
      project: { synopsis: "", coreHook: undefined },
      characters: [],
      outlines: [],
    });
    expect(nextPlanningStep(empty)?.key).toBe("setup");
    const setup = planningProgress({
      project: { synopsis: "旧书店的故事", coreHook: "继承一家书店" },
      characters: [],
      outlines: [entity({ 大纲层级: "章节" })],
    });
    expect(nextPlanningStep(setup)?.key).toBe("characters");
    const all = planningProgress({
      project: { synopsis: "旧书店的故事", coreHook: "继承一家书店" },
      characters: [entity({})],
      outlines: [entity({ 大纲层级: "全书" })],
    });
    expect(nextPlanningStep(all)).toBeUndefined();
  });

  it("只有简介没有核心钩子时设定还不算完成", () => {
    const progress = planningProgress({
      project: { synopsis: "一句话简介", coreHook: " " },
      characters: [],
      outlines: [],
    });
    expect(progress.setup).toBe(false);
  });

  it("修改时带上上一版和作者的新意见", () => {
    const step = PLANNING_STEPS[1];
    const first = planningInstruction({
      step,
      authorLines: ["主角是女性"],
    });
    expect(first).toContain("主角是女性");
    expect(first).not.toContain("上一版");
    const revised = planningInstruction({
      step,
      authorLines: ["主角是女性"],
      previous: {
        title: "人物",
        content: "",
        items: [
          {
            ref: "a",
            kind: "characters",
            title: "林晚",
            data: { 角色定位: "主角" },
          },
        ],
      },
      feedback: "让她更果断",
    });
    expect(revised).toContain("林晚");
    expect(revised).toContain("角色定位：主角");
    expect(revised).toContain("让她更果断");
    const another = planningInstruction({
      step,
      authorLines: [],
      previous: { title: "人物", content: "旧方案", items: [] },
    });
    expect(another).toContain("明显不同");
  });
});

describe("storySetupInstruction", () => {
  it("keeps what the author already wrote and adds the request", () => {
    const text = storySetupInstruction("  基调温暖  ");
    expect(text).toContain("只补全空缺的部分");
    expect(text).toContain("作者的要求：\n基调温暖");
    expect(storySetupInstruction(" ")).not.toContain("作者的要求");
  });
});
