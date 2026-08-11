import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { streamText, type LanguageModel } from "ai";
import type { AgentTaskType } from "@sdns/schema";
import { getLegacyPrompt } from "./prompt-catalog.generated";

export interface LangGraphProviderConfiguration {
  providerKind: "openai" | "anthropic" | "google";
  model: string;
  baseUrl?: string;
  secret: string;
}

export interface LangGraphRunInput {
  prompt: string;
  taskType: AgentTaskType;
  signal?: AbortSignal;
  onTextDelta?(delta: string): void;
  onUsage?(usage: {
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
  }): void;
}

export interface LangGraphRunOutput {
  summary: string;
  content: string;
  data?: unknown;
}

const WorkflowState = Annotation.Root({
  prompt: Annotation<string>(),
  rawOutput: Annotation<string | undefined>(),
  output: Annotation<LangGraphRunOutput | undefined>(),
  error: Annotation<string | undefined>(),
  retryCount: Annotation<number>(),
});

export function createLangGraphModel(
  configuration: LangGraphProviderConfiguration,
): LanguageModel {
  if (configuration.providerKind === "anthropic")
    return createAnthropic({
      apiKey: configuration.secret,
      ...(configuration.baseUrl ? { baseURL: configuration.baseUrl } : {}),
    })(configuration.model);
  if (configuration.providerKind === "google")
    return createGoogleGenerativeAI({
      apiKey: configuration.secret,
      ...(configuration.baseUrl ? { baseURL: configuration.baseUrl } : {}),
    })(configuration.model);
  return createOpenAI({
    apiKey: configuration.secret,
    ...(configuration.baseUrl ? { baseURL: configuration.baseUrl } : {}),
  })(configuration.model);
}

export function buildLangGraphWorkflow(
  configuration: LangGraphProviderConfiguration,
  inputTaskType: AgentTaskType,
  callbacks?: Pick<LangGraphRunInput, "onTextDelta" | "onUsage">,
  signal?: AbortSignal,
) {
  const model = createLangGraphModel(configuration);
  return new StateGraph(WorkflowState)
    .addNode("调用模型", async (state) => {
      if (signal?.aborted) throw new Error("任务已取消");
      const repair =
        state.retryCount > 0
          ? "\n\n上一次输出无法解析。请只返回合法 JSON，不要使用 Markdown 代码块。"
          : "";
      const response = streamText({
        model,
        system:
          "你是 DramaIP 的中文创作助手。只能分析输入上下文并返回结果；不得访问本地文件、执行命令、联网搜索、修改正式数据或直接发起付费生成。不要输出隐藏思维链。",
        prompt: `${getLegacyPrompt(inputTaskType)}\n\n# 统一上下文与任务要求\n${state.prompt}${repair}`,
        abortSignal: signal,
      });
      let rawOutput = "";
      for await (const delta of response.textStream) {
        rawOutput += delta;
        callbacks?.onTextDelta?.(delta);
      }
      const usage = await response.usage;
      callbacks?.onUsage?.({
        inputTokens: Number(usage.inputTokens ?? 0),
        outputTokens: Number(usage.outputTokens ?? 0),
        cachedTokens: Number(usage.cachedInputTokens ?? 0),
      });
      return { rawOutput, error: undefined };
    })
    .addNode("解析结果", (state) => {
      try {
        const output = parseOutput(state.rawOutput ?? "");
        return { output, error: undefined };
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : "模型输出无法解析",
        };
      }
    })
    .addNode("准备修复", (state) => ({
      retryCount: state.retryCount + 1,
      error: undefined,
    }))
    .addEdge(START, "调用模型")
    .addEdge("调用模型", "解析结果")
    .addConditionalEdges(
      "解析结果",
      (state) => (state.error && state.retryCount < 1 ? "修复" : "完成"),
      { 修复: "准备修复", 完成: END },
    )
    .addEdge("准备修复", "调用模型")
    .compile();
}

export async function runLangGraphWorkflow(
  configuration: LangGraphProviderConfiguration,
  input: LangGraphRunInput,
): Promise<LangGraphRunOutput> {
  const graph = buildLangGraphWorkflow(
    configuration,
    input.taskType,
    input,
    input.signal,
  );
  const state = await graph.invoke(
    { prompt: input.prompt, retryCount: 0 },
    { recursionLimit: 8 },
  );
  if (!state.output) throw new Error(state.error ?? "LangGraph 未返回有效结果");
  return state.output;
}

function parseOutput(raw: string): LangGraphRunOutput {
  const trimmed = raw.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)?.[1];
  const objectText = fenced ?? /\{[\s\S]*\}/.exec(trimmed)?.[0] ?? trimmed;
  const value = JSON.parse(objectText) as Record<string, unknown>;
  if (typeof value.summary !== "string")
    throw new Error("模型输出缺少 summary 字段");
  return {
    summary: value.summary,
    content: typeof value.content === "string" ? value.content : value.summary,
    ...(value.data !== undefined ? { data: value.data } : {}),
  };
}
