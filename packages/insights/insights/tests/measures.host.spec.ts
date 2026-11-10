import { describe, expect, it, vi } from "vitest";
import {
  CreativeExecutionRequestPageSchema,
  CreativeWorkflowExecutionSchema,
  creativeExecutionOperation,
  measureCreativeConfigurationFunnel,
  measureCreativeExecution,
} from "@dramaip/contracts/insights";
import { creativeExecutionLedgerFixture } from "../../../../tests/fixtures/creative-execution-ledger.ts";
import { outcomeMeasures, type OutcomeReads } from "../src/measures.ts";

/** One recorded workflow and the request page that lists it. */
function ledger(checkpoint = 10) {
  const value = structuredClone(creativeExecutionLedgerFixture());
  value.projection = { state: "healthy", checkpoint };
  const execution = CreativeWorkflowExecutionSchema.parse(value);
  const page = CreativeExecutionRequestPageSchema.parse({
    projectId: execution.projectId,
    projection: { state: "healthy", checkpoint },
    historyPolicy: "recorded-original-requests-only",
    items: [execution.request],
  });
  return { execution, page, projectId: execution.projectId };
}

function reads(overrides: Partial<OutcomeReads>): OutcomeReads {
  const refused = () => Promise.reject(new Error("not read in this test"));
  return {
    outcomeSummary: refused,
    outcomes: refused,
    executions: refused,
    execution: refused,
    revisionEffort: refused,
    ...overrides,
  };
}

describe("outcome measures", () => {
  it("names each listed request's operation and measures one workflow's runs", async () => {
    const { execution, page, projectId } = ledger();
    const executions = vi.fn(async () => page);
    const read = vi.fn(async () => execution);
    const measures = outcomeMeasures(reads({ executions, execution: read }));
    const list = await measures.executionList(projectId, undefined);
    expect(executions).toHaveBeenCalledWith(projectId, { limit: 25 });
    expect(list.operations).toEqual({
      [execution.workflowId]: creativeExecutionOperation(execution.request),
    });
    const detail = await measures.executionDetail(
      projectId,
      execution.workflowId,
      undefined,
    );
    expect(read).toHaveBeenCalledWith(projectId, execution.workflowId, {
      limit: 25,
    });
    expect(detail).toEqual({
      execution,
      operation: creativeExecutionOperation(execution.request),
      statistics: measureCreativeExecution(execution),
    });
  });

  it("refuses a workflow page that belongs to another workflow", async () => {
    const { execution, projectId } = ledger();
    const measures = outcomeMeasures(
      reads({ execution: async () => execution }),
    );
    await expect(
      measures.executionDetail(projectId, crypto.randomUUID(), undefined),
    ).rejects.toThrow("原运行关联不属于当前项目、工作流或原分页。");
  });

  it("measures the funnel over every page and fences it with the head read again", async () => {
    const { execution, page, projectId } = ledger();
    const measures = outcomeMeasures(
      reads({
        executions: async () => page,
        execution: async () => execution,
      }),
    );
    expect(await measures.configurationFunnel(projectId)).toEqual(
      measureCreativeConfigurationFunnel(projectId, {
        requestPages: [page],
        workflowPages: [
          { workflowId: execution.workflowId, pages: [execution] },
        ],
      }),
    );
  });

  it("answers no funnel when the checkpoint moves during the walk", async () => {
    const { execution, page, projectId } = ledger();
    const moved = { ...page, projection: { state: "healthy", checkpoint: 11 } };
    const executions = vi
      .fn<OutcomeReads["executions"]>()
      .mockResolvedValueOnce(page)
      .mockResolvedValueOnce(moved);
    const measures = outcomeMeasures(
      reads({ executions, execution: async () => execution }),
    );
    await expect(measures.configurationFunnel(projectId)).rejects.toThrow(
      "原配置漏斗检查点变化；请明确重新读取。",
    );
  });
});
