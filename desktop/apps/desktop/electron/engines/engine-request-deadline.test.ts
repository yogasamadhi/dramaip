import { afterEach, expect, jest, test } from "bun:test";
import {
  EngineRequestDeadline,
  EngineRequestTimeoutError,
  publicEngineErrorMessage,
} from "./engine-request-deadline";

afterEach(() => jest.useRealTimers());

test("持续生成的长章不会在两分钟时失败，完成后清理所有期限", () => {
  jest.useFakeTimers();
  const failures: Error[] = [];
  const deadline = new EngineRequestDeadline(true, (error) =>
    failures.push(error),
  );
  for (let i = 0; i < 8; i++) {
    jest.advanceTimersByTime(90_000);
    deadline.touch();
  }
  expect(failures).toHaveLength(0);
  deadline.dispose();
  jest.advanceTimersByTime(60 * 60_000);
  expect(failures).toHaveLength(0);
});

test("无输出的运行在空闲期限结束时失败一次，迟到事件不能复活它", () => {
  jest.useFakeTimers();
  const failures: EngineRequestTimeoutError[] = [];
  const deadline = new EngineRequestDeadline(true, (error) =>
    failures.push(error),
  );
  jest.advanceTimersByTime(120_000);
  expect(failures).toHaveLength(0);
  jest.advanceTimersByTime(180_000);
  expect(failures.map((error) => error.reason)).toEqual(["idle"]);
  deadline.touch();
  jest.advanceTimersByTime(60 * 60_000);
  expect(failures).toHaveLength(1);
});

test("健康与会话控制保持短期限，持续输出也有总运行上限", () => {
  jest.useFakeTimers();
  const reasons: string[] = [];
  new EngineRequestDeadline(false, (error) => reasons.push(error.reason));
  const run = new EngineRequestDeadline(true, (error) =>
    reasons.push(error.reason),
  );
  jest.advanceTimersByTime(20_000);
  expect(reasons).toEqual(["control"]);
  for (let i = 0; i < 30; i++) {
    run.touch();
    jest.advanceTimersByTime(60_000);
  }
  expect(reasons).toEqual(["control", "duration"]);
});

test("超时与服务商问题可区分，底层报文和凭据不会进入公开错误", () => {
  expect(
    publicEngineErrorMessage(new EngineRequestTimeoutError("idle")),
  ).toContain("连续 5 分钟");
  expect(
    publicEngineErrorMessage(
      new Error("401 https://private.invalid token=secret"),
    ),
  ).toBe("模型认证失败，请在 AI 连接中检查凭据。");
  expect(publicEngineErrorMessage(new Error("429 secret"))).toContain(
    "频率受限",
  );
  expect(
    publicEngineErrorMessage(new Error("模型输出达到长度上限 secret")),
  ).toBe("模型输出达到长度上限，未返回完整结果，请缩小创作范围后重试。");
  expect(publicEngineErrorMessage(new Error("fetch failed secret"))).toContain(
    "无法连接模型服务",
  );
  expect(
    publicEngineErrorMessage(new Error("vendor internal secret")),
  ).not.toContain("secret");
});
