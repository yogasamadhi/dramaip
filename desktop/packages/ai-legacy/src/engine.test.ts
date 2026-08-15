import { expect, test } from "bun:test";
import {
  createLangGraphModel,
  langGraphOutputMode,
  parseLangGraphOutput,
} from "./engine";

test("OpenAI 兼容服务商使用聊天补全适配器", () => {
  const model = createLangGraphModel({
    providerKind: "openai",
    providerAdapter: "openai-compatible",
    model: "deepseek-v4-pro",
    baseUrl: "https://api.deepseek.com",
    secret: "测试密钥",
  });
  const runtime = model as unknown as { modelId: string; provider: string };
  expect(runtime.modelId).toBe("deepseek-v4-pro");
  expect(runtime.provider).toBe("dramaip-langgraph.chat");
});

test("OpenAI 兼容服务商必须配置服务地址", () => {
  expect(() =>
    createLangGraphModel({
      providerKind: "openai",
      providerAdapter: "openai-compatible",
      model: "deepseek-v4-pro",
      secret: "测试密钥",
    }),
  ).toThrow("OpenAI 兼容服务商缺少服务地址");
});

test("通用聊天直接接受自然语言，不触发 JSON 修复轮", () => {
  const content =
    "你好！目前尚未绑定项目，我可以先回答通用问题，也可以等你绑定项目后继续创作。";
  expect(parseLangGraphOutput(content, "text")).toEqual({
    summary: content,
    content,
  });
});

test("只有未绑定项目的通用聊天使用文本输出模式", () => {
  expect(langGraphOutputMode("chat_project")).toBe("text");
  expect(langGraphOutputMode("chat_project", "project-1")).toBe("structured");
  expect(langGraphOutputMode("chapter_diagnostic")).toBe("structured");
});

test("兼容模型返回的 response JSON 包装并只保留正式回答", () => {
  expect(
    parseLangGraphOutput('{"response":"你好！我是 DramaIP 的中文创作助手。"}'),
  ).toEqual({
    summary: "你好！我是 DramaIP 的中文创作助手。",
    content: "你好！我是 DramaIP 的中文创作助手。",
  });
});

test("统一 summary/content/data 输出保持结构化数据", () => {
  expect(
    parseLangGraphOutput(`说明文字

\`\`\`json
{"summary":"已完成","content":"正式正文","data":{"score":88}}
\`\`\``),
  ).toEqual({
    summary: "已完成",
    content: "正式正文",
    data: { score: 88 },
  });
});

test("项目任务的非 JSON 输出仍进入受控修复流程", () => {
  expect(() => parseLangGraphOutput("这是一段未封装的正文")).toThrow(
    "模型输出无法解析为 JSON",
  );
  expect(() => parseLangGraphOutput('"这是一段 JSON 字符串"')).toThrow(
    "模型输出必须是 JSON 对象",
  );
});
