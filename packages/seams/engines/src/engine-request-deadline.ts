export const ENGINE_CONTROL_TIMEOUT_MS = 20_000;
export const ENGINE_RUN_IDLE_TIMEOUT_MS = 5 * 60_000;
export const ENGINE_RUN_MAX_DURATION_MS = 30 * 60_000;

export class EngineRequestTimeoutError extends Error {
  constructor(readonly reason: "control" | "idle" | "duration") {
    super(
      reason === "control"
        ? "智能引擎未及时响应操作，请稍后重试。"
        : reason === "idle"
          ? "智能引擎连续 5 分钟未返回进展，已请求停止本次生成，请稍后重试。"
          : "本次生成已超过 30 分钟，已请求停止，请缩小创作范围后重试。",
    );
    this.name = "EngineRequestTimeoutError";
  }
}

/** Model runs have an inactivity deadline; live output renews it. */
export class EngineRequestDeadline {
  private idle?: ReturnType<typeof setTimeout>;
  private maximum?: ReturnType<typeof setTimeout>;
  private closed = false;

  constructor(
    private readonly running: boolean,
    private readonly onTimeout: (error: EngineRequestTimeoutError) => void,
  ) {
    this.touch();
    if (running)
      this.maximum = setTimeout(
        () => this.expire("duration"),
        ENGINE_RUN_MAX_DURATION_MS,
      );
  }

  touch(): void {
    if (this.closed) return;
    clearTimeout(this.idle);
    this.idle = setTimeout(
      () => this.expire(this.running ? "idle" : "control"),
      this.running ? ENGINE_RUN_IDLE_TIMEOUT_MS : ENGINE_CONTROL_TIMEOUT_MS,
    );
  }

  dispose(): void {
    this.closed = true;
    clearTimeout(this.idle);
    clearTimeout(this.maximum);
  }

  private expire(reason: EngineRequestTimeoutError["reason"]): void {
    if (this.closed) return;
    this.dispose();
    this.onTimeout(new EngineRequestTimeoutError(reason));
  }
}

/** Only fixed messages cross the Host boundary; vendor errors can contain secrets. */
export function publicEngineErrorMessage(error: unknown): string {
  if (error instanceof EngineRequestTimeoutError) return error.message;
  const message = error instanceof Error ? error.message : String(error);
  if (
    /输出达到长度上限|max[_ ]?(?:completion[_ ]?)?tokens|output.*limit/i.test(
      message,
    )
  )
    return "模型输出达到长度上限，未返回完整结果，请缩小创作范围后重试。";
  if (/401|unauthorized|authentication|API Key 无效|认证|凭据/i.test(message))
    return "模型认证失败，请在 AI 连接中检查凭据。";
  if (/429|rate.?limit|quota|balance|频率受限|额度不足/i.test(message))
    return "模型服务调用频率受限或账户额度不足，请稍后重试或检查服务商账户。";
  if (/404|unknown model|model.*not found|地址或模型名称不匹配/i.test(message))
    return "模型服务地址或模型名称不匹配，请检查 AI 连接。";
  if (/timeout|timed out|超时/i.test(message))
    return "模型服务响应超时，请稍后重试。";
  if (
    /fetch failed|network|ECONN|ENOTFOUND|TLS|certificate|网络/i.test(message)
  )
    return "无法连接模型服务，请检查网络和服务地址后重试。";
  return "智能引擎调用失败，请检查模型配置和引擎状态后重试。";
}
