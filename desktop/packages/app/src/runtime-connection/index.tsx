import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createStudioClient, type StudioClient } from "@dramaip/client";
import type { RuntimeInfo } from "@dramaip/contracts";
import {
  ServerConnectionManager,
  type ConnectionState,
} from "@dramaip/server-connection";

interface RuntimeConnectionValue {
  readonly state: ConnectionState;
  readonly client?: StudioClient;
  readonly runtime?: RuntimeInfo;
  readonly error?: Error;
  reconnect(): void;
}

const RuntimeConnectionContext = createContext<
  RuntimeConnectionValue | undefined
>(undefined);

export function RuntimeConnectionProvider(props: {
  readonly children: ReactNode;
}) {
  const manager = useMemo(() => new ServerConnectionManager(), []);
  const [attempt, setAttempt] = useState(0);
  const [value, setValue] = useState<Omit<RuntimeConnectionValue, "reconnect">>(
    {
      state: manager.state,
    },
  );

  useEffect(() => {
    let active = true;
    setValue({ state: manager.state });
    const unsubscribe = manager.subscribe((state) => {
      if (active) setValue((current) => ({ ...current, state }));
    });
    void window.runtimeBootstrap
      .resolve()
      .then(async (bootstrap) => {
        const connection = await manager.attach({
          baseUrl: bootstrap.baseUrl,
          accessToken: bootstrap.accessToken,
          source: "spawned",
          runtimeId: bootstrap.runtimeId,
          runtimeGeneration: bootstrap.runtimeGeneration,
        });
        const client = createStudioClient(manager.createTransport());
        if (active)
          setValue({
            state: manager.state,
            client,
            runtime: connection.runtime,
          });
      })
      .catch((error: unknown) => {
        if (active)
          setValue({
            state: manager.state,
            error: error instanceof Error ? error : new Error(String(error)),
          });
      });
    return () => {
      active = false;
      unsubscribe();
      manager.disconnect();
    };
  }, [attempt, manager]);

  const contextValue = useMemo<RuntimeConnectionValue>(
    () => ({ ...value, reconnect: () => setAttempt((current) => current + 1) }),
    [value],
  );

  return (
    <RuntimeConnectionContext.Provider value={contextValue}>
      {props.children}
    </RuntimeConnectionContext.Provider>
  );
}

export function useRuntimeConnection(): RuntimeConnectionValue {
  const value = useContext(RuntimeConnectionContext);
  if (!value) throw new Error("运行时连接上下文尚未初始化");
  return value;
}

export function useStudioClient(): StudioClient {
  const { client } = useRuntimeConnection();
  if (!client) throw new Error("工作台服务尚未初始化");
  return client;
}
