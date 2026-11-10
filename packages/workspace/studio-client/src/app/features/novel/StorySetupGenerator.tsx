import { useEffect, useState } from "react";
import { BareButton, Button, Textarea } from "@dramaip/infra-ui-primitives";
import type { CreationWorkflow } from "@dramaip/contracts/creation";
import { useStudio, message as errorText } from "../../studio-shared";
import { AiSettingsLink } from "../../studio-session";
import { CREATION_STAGE_LABELS } from "../creation-workbench";
import { DraftItems } from "./NovelPlanningGuide";
import {
  ACTIVE_CREATION_STAGES,
  storySetupInstruction,
} from "./novel-planning";
import styles from "./NovelPlanningGuide.module.css";

const STORAGE_PREFIX = "dramaip-story-setup-draft:";

function readDraftId(projectId: string): string | undefined {
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + projectId) ?? undefined;
  } catch {
    return undefined;
  }
}

function saveDraftId(projectId: string, id: string | undefined): void {
  try {
    if (id) window.localStorage.setItem(STORAGE_PREFIX + projectId, id);
    else window.localStorage.removeItem(STORAGE_PREFIX + projectId);
  } catch {
    // The draft also waits in the review queue; this only reopens it here.
  }
}

/**
 * The 设定 tab's AI helper: one request becomes a story setup draft that fills
 * the project's fields once the author adopts it. The fields already written
 * are kept unless the request asks to change them.
 */
export function StorySetupGenerator(props: {
  projectId: string;
  title: string;
  description: string;
  defaultInstruction?: string;
  onCommitted(): void | Promise<void>;
}) {
  const client = useStudio();
  const { projectId } = props;
  const [workflowId, setWorkflowId] = useState(() => readDraftId(projectId));
  const [workflow, setWorkflow] = useState<CreationWorkflow>();
  const [expanded, setExpanded] = useState(Boolean(workflowId));
  const [request, setRequest] = useState(props.defaultInstruction ?? "");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const running = Boolean(
    workflowId && (!workflow || ACTIVE_CREATION_STAGES.has(workflow.stage)),
  );

  useEffect(() => saveDraftId(projectId, workflowId), [projectId, workflowId]);
  useEffect(() => {
    if (!workflowId) return;
    let stopped = false;
    let timer: number | undefined;
    const read = async () => {
      const value = await client.creation
        .get(workflowId)
        .catch(() => undefined);
      if (stopped) return;
      if (!value) {
        setWorkflowId(undefined);
        return;
      }
      setWorkflow(value);
      if (ACTIVE_CREATION_STAGES.has(value.stage))
        timer = window.setTimeout(() => void read(), 1500);
    };
    void read();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [client, workflowId]);

  const generate = async () => {
    setBusy(true);
    setNotice(undefined);
    setError(undefined);
    try {
      const settings = await client.agentEngines.getProjectSettings(projectId);
      const started = await client.creation.start(
        {
          projectId,
          operation: "story-setup",
          instruction: storySetupInstruction(request),
          sourceIds: [],
          engineKind: settings.defaultEngineKind,
          ...(settings.defaultModel
            ? { model: { ...settings.defaultModel } }
            : {}),
        },
        crypto.randomUUID(),
      );
      // A new draft replaces one still waiting for review.
      if (workflow?.previewId && workflow.stage === "awaiting-review")
        void client.changePreviews
          .discard(workflow.previewId, crypto.randomUUID())
          .catch(() => undefined);
      setWorkflow(started);
      setWorkflowId(started.id);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const adopt = async () => {
    if (!workflow?.previewId) return;
    setBusy(true);
    setNotice(undefined);
    setError(undefined);
    try {
      await client.changePreviews.commit(
        workflow.previewId,
        crypto.randomUUID(),
      );
      setWorkflow(undefined);
      setWorkflowId(undefined);
      setNotice("故事设定已写入下面的项目设定，可以继续手动修改。");
      await props.onCommitted();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    setBusy(true);
    setNotice(undefined);
    setError(undefined);
    try {
      if (workflow?.previewId && workflow.stage === "awaiting-review")
        await client.changePreviews.discard(
          workflow.previewId,
          crypto.randomUUID(),
        );
      setWorkflow(undefined);
      setWorkflowId(undefined);
      setNotice("已放弃这一版。");
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const retry = async () => {
    if (!workflow) return;
    setBusy(true);
    setNotice(undefined);
    setError(undefined);
    try {
      const value = await client.creation.action(
        workflow.id,
        "retry",
        crypto.randomUUID(),
      );
      setWorkflow(value);
      setWorkflowId(value.id);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const failed =
    workflow?.stage === "failed" || workflow?.stage === "interrupted";
  const warnings =
    workflow?.issues.filter((issue) => issue.severity !== "error") ?? [];
  return (
    <section className={styles.draft} aria-label={props.title}>
      <BareButton
        className={styles.step}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span>
          {props.title}
          <span className={styles.stepState}>{props.description}</span>
        </span>
        <span className={styles.hint}>{expanded ? "收起" : "开始"}</span>
      </BareButton>
      {expanded && (
        <div className={styles.composer}>
          <Textarea
            aria-label="对项目设定的要求"
            className={styles.input}
            value={request}
            rows={3}
            disabled={busy || running}
            placeholder="例如：现代都市，被裁员的程序员继承了快倒闭的旧书店；想要温暖治愈的基调。也可以不填，直接补全空缺的设定。"
            onChange={(event) => setRequest(event.target.value)}
          />
          <div className={styles.composerActions}>
            <Button disabled={busy || running} onClick={() => void generate()}>
              {busy && !workflow
                ? "正在开始…"
                : workflow?.stage === "awaiting-review"
                  ? "换一版"
                  : "生成故事设定"}
            </Button>
          </div>
          {workflow && running && (
            <p role="status" className={styles.muted}>
              {CREATION_STAGE_LABELS[workflow.stage]}…
            </p>
          )}
          {workflow?.output && workflow.stage === "awaiting-review" && (
            <div className={styles.draft}>
              <DraftItems output={workflow.output} setup />
              {warnings.length > 0 && (
                <ul className={styles.warnings} aria-label="检查提示">
                  {warnings.map((issue, index) => (
                    <li key={index}>{issue.message}</li>
                  ))}
                </ul>
              )}
              <div className={styles.actions}>
                <Button size="sm" disabled={busy} onClick={() => void adopt()}>
                  采用故事设定
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void discard()}
                >
                  放弃
                </Button>
                <span className={styles.hint}>
                  采用后写入下面的设定，项目名称不会改变。
                </span>
              </div>
            </div>
          )}
          {failed && (
            <div className={styles.failed}>
              <p role="alert">
                {workflow?.error ?? "AI 没能完成这一版，请重试或换个说法。"}
              </p>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => void retry()}
              >
                重试
              </Button>
            </div>
          )}
          {notice && (
            <p role="status" className={styles.muted}>
              {notice}
            </p>
          )}
          {error && (
            <div className={styles.notice} role="alert">
              <p>{error}</p>
              <AiSettingsLink
                actionId="story-setup"
                projectId={projectId}
                returnTo={`/projects/${encodeURIComponent(projectId)}?section=settings`}
                className={styles.link}
              >
                检查 AI 模型设置
              </AiSettingsLink>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
