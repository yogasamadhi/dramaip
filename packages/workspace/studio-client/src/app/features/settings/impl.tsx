import type {
  AgentEngineKind,
  AgentExperimentEngineKind,
} from "@dramaip/contracts/product";
import { BareButton, Button } from "@dramaip/infra-ui-primitives";
import { useQuery, useQueryClient } from "../../query";
import { useEffect, useRef } from "react";
import { useNavigate } from "../../router";
import { useStudio } from "../../studio-shared";
import { safeLocalRoute, useStudioSession } from "../../studio-session";
import styles from "./impl.module.css";
import { copyText } from "../../copy";

/**
 * The creation checklist, shown while a creation step waits on a working
 * engine: the single next step, then the way back to the waiting action. The
 * system settings page mounts it as its own `settings.section` entry above
 * the agents client's AI section, whose connection tests it reads through
 * `useReadyProvider`.
 */
export function SettingsAiPreparationSection(props: {
  useReadyProvider: () => string | undefined;
}) {
  const testedProviderId = props.useReadyProvider();
  const client = useStudio();
  const queryClient = useQueryClient();
  const session = useStudioSession();
  const navigate = useNavigate();
  const returnButtonRef = useRef<HTMLButtonElement>(null);
  const { data: engines = [], isFetching } = useQuery({
    queryKey: ["agent-engines"],
    queryFn: client.agentEngines.list,
    refetchInterval: 2_000,
  });
  const { data: providers = [] } = useQuery({
    queryKey: ["resource", "providers"],
    queryFn: () => client.resources.list("providers"),
  });
  const intent = session.pendingIntent;
  const runnableEngine = engines.find(
    (engine) => engine.canRun ?? engine.status === "available",
  );
  useEffect(() => {
    if (intent && runnableEngine) returnButtonRef.current?.focus();
  }, [intent, runnableEngine]);
  if (!intent) return null;
  const returnTo = safeLocalRoute(intent.returnTo) ?? "/";
  const failureReasons = engines
    .filter((engine) => !(engine.canRun ?? engine.status === "available"))
    .map(
      (engine) =>
        `${engine.name}：${engine.statusMessage ?? "尚未达到可运行状态"}`,
    );
  const returnToCreation = () => {
    if (intent.projectId) session.selectProject(intent.projectId);
    navigate(returnTo);
  };
  const nextStep = !providers.length
    ? "保存一个模型服务商"
    : !testedProviderId
      ? "对准备使用的服务商执行连接测试"
      : `将${providers.find((provider) => provider.id === testedProviderId)?.title ?? "已测试的服务商"}设为智能助手模型`;
  return (
    <section className={styles.c1}>
      <p className={styles.c2}>{copyText("app/features/settings/impl.1")}</p>
      <h2 className={styles.c3}>{copyText("app/features/settings/impl.2")}</h2>
      <p className={styles.c4}>{copyText("app/features/settings/impl.3")}</p>
      {!runnableEngine && (
        <div className={styles.c5}>
          <p className={styles.c6}>
            {copyText("app/features/settings/impl.4")}
          </p>
          <p className={styles.c7}>{nextStep}</p>
          <p className={styles.c8}>
            {copyText("app/features/settings/impl.5")}
          </p>
        </div>
      )}
      {runnableEngine ? (
        <div className={styles.c9}>
          <p>
            {copyText("app/features/settings/impl.6")}
            {runnableEngine.name} {copyText("app/features/settings/impl.7")}
          </p>
          <Button
            ref={returnButtonRef}
            className={styles.c10}
            onClick={returnToCreation}
          >
            {copyText("app/features/settings/impl.8")}
          </Button>
        </div>
      ) : (
        <div className={styles.c11}>
          <p>
            {isFetching
              ? "正在刷新智能引擎状态…"
              : "配置尚未达到可运行状态，请按上方顺序完成并重试。"}
          </p>
          {failureReasons.length > 0 && (
            <ul className={styles.c12}>
              {failureReasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
          <p className={styles.c13}>
            {copyText("app/features/settings/impl.9")}
          </p>
        </div>
      )}
      <div className={styles.c14}>
        <BareButton
          className={styles.c15}
          onClick={() =>
            void queryClient.invalidateQueries({ queryKey: ["agent-engines"] })
          }
        >
          {copyText("app/features/settings/impl.10")}
        </BareButton>
        <BareButton
          className={styles.c16}
          onClick={() => {
            session.clearPendingIntent();
            returnToCreation();
          }}
        >
          {copyText("app/features/settings/impl.11")}
        </BareButton>
      </div>
    </section>
  );
}

export const AGENT_ENGINE_LABELS: Record<AgentEngineKind, string> = {
  pi: "Pi",
};
export const AGENT_EXPERIMENT_ENGINE_LABELS: Record<
  AgentExperimentEngineKind,
  string
> = AGENT_ENGINE_LABELS;
