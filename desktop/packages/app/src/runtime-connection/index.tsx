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
}

const RuntimeConnectionContext = createContext<
  RuntimeConnectionValue | undefined
>(undefined);

export function RuntimeConnectionProvider(props: {
  readonly children: ReactNode;
}) {
  const manager = useMemo(() => new ServerConnectionManager(), []);
  const [value, setValue] = useState<RuntimeConnectionValue>({
    state: manager.state,
  });

  useEffect(() => {
    let active = true;
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
  }, [manager]);

  return (
    <RuntimeConnectionContext.Provider value={value}>
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
