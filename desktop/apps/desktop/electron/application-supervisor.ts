export interface StoppableComponent {
  stop(): Promise<void>;
}

export interface ClosableComponent {
  close(): void;
}

async function stopWithin(
  component: StoppableComponent | undefined,
  timeoutMs: number,
): Promise<void> {
  if (!component) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      component.stop(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`component stop exceeded ${timeoutMs}ms`)),
          timeoutMs,
        );
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Enforces the only supported shutdown sequence for the desktop process. */
export async function shutdownApplication(input: {
  closeWindows(): void;
  disposeCredentialCapture(): void;
  engines: readonly (StoppableComponent | undefined)[];
  runtime?: StoppableComponent;
  host?: ClosableComponent;
  disposeSupervision(): void;
  engineTimeoutMs?: number;
  runtimeTimeoutMs?: number;
  onError?(phase: string, error: unknown): void;
}): Promise<void> {
  const attempt = async (phase: string, action: () => void | Promise<void>) => {
    try {
      await action();
    } catch (error) {
      input.onError?.(phase, error);
    }
  };
  await attempt("windows", input.closeWindows);
  await attempt("credential-capture", input.disposeCredentialCapture);
  await Promise.all(
    input.engines.map((engine, index) =>
      attempt(`engine:${index}`, () =>
        stopWithin(engine, input.engineTimeoutMs ?? 20_000),
      ),
    ),
  );
  await attempt("runtime", () =>
    stopWithin(input.runtime, input.runtimeTimeoutMs ?? 10_000),
  );
  await attempt("host", () => input.host?.close());
  await attempt("supervision", input.disposeSupervision);
}
