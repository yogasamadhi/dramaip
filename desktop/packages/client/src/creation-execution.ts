import {
  CreationExecutionReceiptSchema,
  type CreationExecutionReceipt,
  type CreationWorkflow,
} from "@dramaip/contracts/creation";
import {
  AgentContextSnapshotSchema,
  agentContextManifestJSON,
  type AgentContextSnapshot,
} from "@dramaip/contracts";

type OriginalWorkflow = Pick<
  CreationWorkflow,
  "id" | "version" | "input" | "runIds" | "sourceWorkflowId"
>;

export interface CreationExecutionClient {
  read(
    workflow: OriginalWorkflow,
    signal?: AbortSignal,
  ): Promise<CreationExecutionReceipt>;
  readContext(
    workflow: OriginalWorkflow,
    runId: string,
    signal?: AbortSignal,
  ): Promise<AgentContextSnapshot>;
}
export function createCreationExecutionClient(
  request: <T>(path: string, init?: RequestInit) => Promise<T>,
): CreationExecutionClient {
  const client: CreationExecutionClient = {
    read: async (workflow, signal) => {
      const receipt = CreationExecutionReceiptSchema.parse(
        await request(
          `/api/v2/workflows/creation/${encodeURIComponent(workflow.id)}/execution?${new URLSearchParams({ projectId: workflow.input.projectId })}`,
          { signal },
        ),
      );
      if (
        receipt.workflowId !== workflow.id ||
        receipt.projectId !== workflow.input.projectId ||
        receipt.operation !== workflow.input.operation ||
        receipt.version !== workflow.version ||
        receipt.sourceWorkflowId !== workflow.sourceWorkflowId ||
        JSON.stringify(receipt.runs.map((run) => run.runId)) !==
          JSON.stringify(workflow.runIds) ||
        receipt.runs.some(
          (run) =>
            run.state === "recorded" &&
            run.execution.engineKind !== workflow.input.engineKind,
        )
      )
        throw new Error(
          "执行记录与指定原工作流版本、项目、操作或运行顺序不一致，请重新核对原运行。",
        );
      return receipt;
    },
    readContext: async (workflow, runId, signal) => {
      if (!workflow.runIds.includes(runId))
        throw new Error("不能用其他运行替代本工作流原阶段上下文。");
      const receipt = await client.read(workflow, signal);
      const run = receipt.runs.find((item) => item.runId === runId);
      if (run?.state !== "recorded" || !run.execution.contextSnapshotId)
        throw new Error(
          "原阶段未记录上下文快照；实际输入未知，不补用首次或最近运行。",
        );
      const snapshot = AgentContextSnapshotSchema.parse(
        await request(
          `/api/v2/agent-runs/${encodeURIComponent(runId)}/context-snapshot`,
          { signal },
        ),
      );
      if (
        snapshot.id !== run.execution.contextSnapshotId ||
        snapshot.projectId !== workflow.input.projectId
      )
        throw new Error("上下文快照与原运行或项目不一致。");
      const sha256 = async (value: string) =>
        Array.from(
          new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(value),
            ),
          ),
          (byte) => byte.toString(16).padStart(2, "0"),
        ).join("");
      if (
        (await sha256(snapshot.finalPrompt)) !== snapshot.finalPromptSha256 ||
        (await sha256(
          agentContextManifestJSON({
            projectId: snapshot.projectId,
            destination: snapshot.destination,
            tokenBudget: snapshot.tokenBudget,
            entries: snapshot.entries,
          }),
        )) !== snapshot.manifestSha256
      )
        throw new Error(
          "原上下文字节与记录的指纹不一致，不能作为本轮输入展示。",
        );
      const observed = await client.read(workflow, signal);
      const current = observed.runs.find((item) => item.runId === runId);
      if (
        current?.state !== "recorded" ||
        current.phase !== run.phase ||
        current.execution.contextSnapshotId !== snapshot.id
      )
        throw new Error("读取期间原阶段绑定已变化，请重新核对。");
      return snapshot;
    },
  };
  return client;
}
