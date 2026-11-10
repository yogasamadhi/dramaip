import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { BareButton, Button, Textarea } from "@dramaip/infra-ui-primitives";
import type { CreationWorkflow } from "@dramaip/contracts/creation";
import type { DomainEntity, Project } from "@dramaip/contracts/product";
import { useStudio, message as errorText } from "../../studio-shared";
import { AiSettingsLink } from "../../studio-session";
import { CREATION_STAGE_LABELS } from "../creation-workbench";
import {
  ACTIVE_CREATION_STAGES as ACTIVE,
  PLANNING_STEPS,
  SETUP_ORDER,
  fieldText,
  nextPlanningStep,
  planningInstruction,
  planningProgress,
  readPlanningMessages,
  savePlanningMessages,
  type PlanningMessage,
  type PlanningStep,
  type PlanningStepKey,
} from "./novel-planning";
import styles from "./NovelPlanningGuide.module.css";

/** The items of an AI draft as titled field lists. */
export function DraftItems(props: {
  output: NonNullable<CreationWorkflow["output"]>;
  setup?: boolean;
}) {
  return (
    <div className={styles.items}>
      {props.output.items.map((entry) => {
        const fields = Object.entries(entry.data).filter(
          ([key, value]) =>
            fieldText(value).trim() &&
            !["sourceWorkflowId", "大纲层级"].includes(key),
        );
        if (props.setup)
          fields.sort(
            ([a], [b]) =>
              (SETUP_ORDER.indexOf(a) + 1 || 99) -
              (SETUP_ORDER.indexOf(b) + 1 || 99),
          );
        return (
          <article key={entry.ref} className={styles.item}>
            <h4 className={styles.itemTitle}>{entry.title}</h4>
            <dl className={styles.fields}>
              {fields.map(([key, value]) => (
                <div key={key} className={styles.field}>
                  <dt className={styles.fieldName}>{key}</dt>
                  <dd className={styles.fieldValue}>{fieldText(value)}</dd>
                </div>
              ))}
            </dl>
          </article>
        );
      })}
    </div>
  );
}

/**
 * The novel's planning conversation: the author says what the story is, and
 * the AI drafts the story setup, the main characters and the book outline in
 * turn. Each draft is saved only when the author adopts it; replying to a
 * draft asks for a revised one. Everything stays editable on its own tab.
 */
export function NovelPlanningGuide(props: {
  project: Project;
  onOpen(section: "chapters" | PlanningStep["section"]): void;
  onProjectChanged(): Promise<void>;
}) {
  const client = useStudio();
  const projectId = props.project.id;
  const [messages, setMessages] = useState<PlanningMessage[]>(() =>
    readPlanningMessages(projectId),
  );
  const [workflows, setWorkflows] = useState<Record<string, CreationWorkflow>>(
    {},
  );
  const [characters, setCharacters] = useState<DomainEntity[]>();
  const [outlines, setOutlines] = useState<DomainEntity[]>();
  const [chosen, setChosen] = useState<PlanningStepKey>();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const logRef = useRef<HTMLDivElement>(null);

  const loadMaterials = async () => {
    const [characterItems, outlineItems] = await Promise.all([
      client.resources.list("characters", projectId),
      client.resources.list("outlines", projectId),
    ]);
    setCharacters(characterItems);
    setOutlines(outlineItems);
  };
  useEffect(() => {
    void loadMaterials().catch((cause) => setNotice(errorText(cause)));
  }, [client, projectId]);
  useEffect(() => savePlanningMessages(projectId, messages), [messages]);

  // Read every draft the conversation refers to, and follow running ones.
  const ids = messages
    .map((item) => item.workflowId)
    .filter((id): id is string => Boolean(id));
  const pending = ids.filter((id) => {
    const value = workflows[id];
    return !value || ACTIVE.has(value.stage);
  });
  useEffect(() => {
    if (!pending.length) return;
    let stopped = false;
    const read = async () => {
      const read = await Promise.all(
        pending.map((id) => client.creation.get(id).catch(() => undefined)),
      );
      if (stopped) return;
      setWorkflows((current) => {
        const next = { ...current };
        for (const value of read) if (value) next[value.id] = value;
        return next;
      });
    };
    void read();
    const timer = window.setInterval(() => void read(), 1500);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [client, pending.join(",")]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages.length, Object.keys(workflows).length]);

  const loaded = characters !== undefined && outlines !== undefined;
  const done = planningProgress({
    project: props.project,
    characters: characters ?? [],
    outlines: outlines ?? [],
  });
  const next = nextPlanningStep(done);
  const step =
    PLANNING_STEPS.find((item) => item.key === chosen) ?? next ?? undefined;
  const stepMessages = (key: PlanningStepKey) =>
    messages.filter((item) => item.step === key);
  const lastDraft = (key: PlanningStepKey) => {
    const id = stepMessages(key)
      .map((item) => item.workflowId)
      .filter(Boolean)
      .at(-1);
    return id ? workflows[id] : undefined;
  };
  const running = ids.some((id) => {
    const value = workflows[id];
    return !value || ACTIVE.has(value.stage);
  });

  const say = (line: Omit<PlanningMessage, "id">) =>
    setMessages((current) => [
      ...current,
      { ...line, id: crypto.randomUUID() },
    ]);

  /** Ask the AI for a draft of `target`, optionally revising the last one. */
  const draft = async (target: PlanningStep, feedback?: string) => {
    setBusy(true);
    setNotice(undefined);
    try {
      const previous = lastDraft(target.key);
      const revising =
        previous?.output && previous.stage !== "applied" ? previous : undefined;
      const authorLines = [
        ...stepMessages(target.key)
          .filter((item) => item.role === "author")
          .map((item) => item.text),
        ...(feedback && !revising ? [feedback] : []),
      ];
      const settings = await client.agentEngines.getProjectSettings(projectId);
      const workflow = await client.creation.start(
        {
          projectId,
          operation: target.operation,
          instruction: planningInstruction({
            step: target,
            authorLines,
            ...(revising
              ? { previous: revising.output, feedback: feedback ?? "" }
              : {}),
          }),
          sourceIds: [],
          engineKind: settings.defaultEngineKind,
          ...(settings.defaultModel
            ? { model: { ...settings.defaultModel } }
            : {}),
        },
        crypto.randomUUID(),
      );
      // An unadopted earlier draft is replaced, so it does not wait for review.
      if (revising?.previewId && revising.stage === "awaiting-review")
        void client.changePreviews
          .discard(revising.previewId, crypto.randomUUID())
          .catch(() => undefined);
      setWorkflows((current) => ({ ...current, [workflow.id]: workflow }));
      say({
        role: "ai",
        step: target.key,
        text: revising
          ? `好的，按你的意见修改${target.label}。`
          : `正在整理${target.label}…`,
        workflowId: workflow.id,
      });
    } catch (cause) {
      setNotice(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    const line = text.trim();
    if (!line || !step || busy || running) return;
    setText("");
    say({ role: "author", step: step.key, text: line });
    await draft(step, line);
  };

  const adopt = async (target: PlanningStep, workflow: CreationWorkflow) => {
    if (!workflow.previewId) return;
    setBusy(true);
    setNotice(undefined);
    try {
      await client.changePreviews.commit(
        workflow.previewId,
        crypto.randomUUID(),
      );
      setWorkflows((current) => ({
        ...current,
        [workflow.id]: { ...workflow, stage: "applied" },
      }));
      await Promise.all([props.onProjectChanged(), loadMaterials()]);
      setChosen(undefined);
      const after = PLANNING_STEPS[PLANNING_STEPS.indexOf(target) + 1];
      say({
        role: "ai",
        step: target.key,
        text: `${target.label}已保存，可以随时在「${
          target.section === "settings"
            ? "设定"
            : target.section === "characters"
              ? "人物"
              : "大纲"
        }」里修改。`,
      });
      if (after && !done[after.key])
        say({ role: "ai", step: after.key, text: after.ask });
    } catch (cause) {
      setNotice(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const retry = async (workflow: CreationWorkflow) => {
    setBusy(true);
    setNotice(undefined);
    try {
      const value = await client.creation.action(
        workflow.id,
        "retry",
        crypto.randomUUID(),
      );
      setWorkflows((current) => ({ ...current, [value.id]: value }));
      setMessages((current) =>
        current.map((item) =>
          item.workflowId === workflow.id
            ? { ...item, workflowId: value.id }
            : item,
        ),
      );
    } catch (cause) {
      setNotice(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const latestDraftId = (key: PlanningStepKey) =>
    stepMessages(key)
      .map((item) => item.workflowId)
      .filter(Boolean)
      .at(-1);

  const renderDraft = (item: PlanningMessage) => {
    const target = PLANNING_STEPS.find((value) => value.key === item.step)!;
    const workflow = item.workflowId ? workflows[item.workflowId] : undefined;
    if (!workflow)
      return (
        <p role="status" className={styles.muted}>
          正在读取 AI 草稿…
        </p>
      );
    const latest = latestDraftId(item.step) === workflow.id;
    if (ACTIVE.has(workflow.stage))
      return (
        <p role="status" className={styles.muted}>
          {CREATION_STAGE_LABELS[workflow.stage]}…
        </p>
      );
    const output = workflow.output;
    const warnings = workflow.issues.filter(
      (issue) => issue.severity !== "error",
    );
    return (
      <div className={styles.draft}>
        {output && <DraftItems output={output} setup={item.step === "setup"} />}
        {warnings.length > 0 && (
          <ul className={styles.warnings} aria-label="检查提示">
            {warnings.map((issue, index) => (
              <li key={index}>{issue.message}</li>
            ))}
          </ul>
        )}
        {workflow.stage === "applied" && (
          <p className={styles.adopted}>已采用</p>
        )}
        {(workflow.stage === "discarded" || workflow.stage === "canceled") && (
          <p className={styles.muted}>这一版已被替换。</p>
        )}
        {(workflow.stage === "failed" || workflow.stage === "interrupted") && (
          <div className={styles.failed}>
            <p role="alert">
              {workflow.error ?? "AI 没能完成这一版，请重试或换个说法。"}
            </p>
            {latest && (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => void retry(workflow)}
              >
                重试
              </Button>
            )}
          </div>
        )}
        {latest && workflow.stage === "awaiting-review" && (
          <div className={styles.actions}>
            <Button
              size="sm"
              disabled={busy || running}
              onClick={() => void adopt(target, workflow)}
            >
              采用{target.label}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || running}
              onClick={() => void draft(target)}
            >
              换一版
            </Button>
            <span className={styles.hint}>
              不满意哪里，直接在下面说，AI 会按你的意见改。
            </span>
          </div>
        )}
      </div>
    );
  };

  const allDone = loaded && !next;
  // The conversation opens on the step it starts from: a project whose
  // setup was written by hand starts at the characters.
  const opening = PLANNING_STEPS.find(
    (item) => item.key === (messages[0]?.step ?? next?.key),
  );
  return (
    <section className={styles.root} aria-label="构思">
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>和 AI 一起构思</h2>
          <p className={styles.subtitle}>
            说说你的想法，AI
            会依次整理出故事设定、主要人物和全书大纲。每一步都由你确认后才保存，之后也能在对应页面手动修改。
          </p>
        </div>
        <BareButton
          className={styles.skip}
          onClick={() => props.onOpen("chapters")}
        >
          {allDone ? "去写正文" : "跳过，直接写正文"}
        </BareButton>
      </header>
      <ol className={styles.steps} aria-label="构思进度">
        {PLANNING_STEPS.map((item, index) => (
          <li key={item.key}>
            <BareButton
              className={clsx(
                styles.step,
                done[item.key] && styles.stepDone,
                step?.key === item.key && styles.stepCurrent,
              )}
              aria-current={step?.key === item.key ? "step" : undefined}
              disabled={busy || running}
              onClick={() => setChosen(item.key)}
            >
              <span className={styles.stepIndex} aria-hidden="true">
                {done[item.key] ? "✓" : index + 1}
              </span>
              <span>
                {item.label}
                <span className={styles.stepState}>
                  {done[item.key] ? "已完成" : loaded ? "未完成" : ""}
                </span>
              </span>
            </BareButton>
          </li>
        ))}
      </ol>
      <div ref={logRef} className={styles.log} role="log" aria-label="构思对话">
        {loaded && opening && (
          <div className={styles.ai}>
            <p className={styles.bubble}>
              {opening.key === "setup" || messages.length
                ? opening.ask
                : `已有的资料我都会参考。${opening.ask.slice(opening.ask.indexOf("。") + 1)}`}
            </p>
          </div>
        )}
        {messages.map((item) => (
          <div
            key={item.id}
            className={item.role === "author" ? styles.author : styles.ai}
          >
            <p className={styles.bubble}>{item.text}</p>
            {item.workflowId && renderDraft(item)}
          </div>
        ))}
        {chosen && done[chosen] && (
          <div className={styles.ai}>
            <p className={styles.bubble}>
              {`想重新做${step?.label}吗？说说要怎么改，或者直接点「${step?.action}」。新的一版采用后会加到现有资料里，旧的可以在对应页面删除。`}
            </p>
          </div>
        )}
        {allDone && !chosen && (
          <div className={styles.ai}>
            <p className={styles.bubble}>
              构思完成！设定、人物和大纲都已保存，后面写每一章时 AI
              都会参考它们。现在可以开始写第一章了。
            </p>
            <div className={styles.actions}>
              <Button size="sm" onClick={() => props.onOpen("chapters")}>
                开始写第一章
              </Button>
            </div>
          </div>
        )}
      </div>
      {notice && (
        <div className={styles.notice} role="alert">
          <p>{notice}</p>
          <AiSettingsLink
            actionId="novel-planning"
            projectId={projectId}
            returnTo={`/projects/${encodeURIComponent(projectId)}?section=plan`}
            className={styles.link}
          >
            检查 AI 模型设置
          </AiSettingsLink>
        </div>
      )}
      {step && (
        <div className={styles.composer}>
          <Textarea
            aria-label="和 AI 说说你的想法"
            className={styles.input}
            value={text}
            rows={3}
            disabled={busy}
            placeholder={
              step.key === "setup"
                ? "例如：现代都市，一个被裁员的程序员意外继承了一家快倒闭的旧书店……"
                : `对${step.label}有什么要求？也可以不填，直接点「${step.action}」。`
            }
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                (event.metaKey || event.ctrlKey) &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <div className={styles.composerActions}>
            <span className={styles.hint}>Ctrl/⌘ + Enter 发送</span>
            {step.key !== "setup" && !text.trim() ? (
              <Button
                disabled={busy || running || !loaded}
                onClick={() => void draft(step)}
              >
                {busy ? "正在开始…" : step.action}
              </Button>
            ) : (
              <Button
                disabled={busy || running || !text.trim()}
                onClick={() => void send()}
              >
                {busy ? "正在开始…" : "发送"}
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
