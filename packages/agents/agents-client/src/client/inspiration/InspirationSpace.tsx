import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { Button } from "@dramaip/infra-ui-primitives";
import { messageOf, value } from "../ai-settings.ts";
import { WebAccessSwitch } from "../assistant/Activity.tsx";
import { AssistantTimeline } from "../assistant/AssistantTimeline.tsx";
import {
  activeRun,
  type AssistantConversation,
  type AssistantDetail,
  type WebAccessMode,
} from "../assistant/types.ts";
import { usePublishedEvents } from "../events.ts";
import type { Translate } from "../task-config/copy.ts";
import css from "./Inspiration.module.css";
import {
  creativeMode,
  MODES,
  readOutcomes,
  type ConversationSummary,
  type CreativeMode,
  type InspirationRemotes,
  type Outcomes,
  type SpaceEngine,
} from "./records.ts";
import { SidePanels } from "./SidePanels.tsx";
import { useDialog } from "./useDialog.tsx";

/** The browser key that remembers the open conversation across visits. */
const STORED_CONVERSATION = "dramaip-inspiration-conversation";

const MEMORY_COMPLETED = "agents.inspiration-memory-completed.v1";

/** What the project conversion panel under the cards is handed. */
export interface InspirationConversionProps {
  /** The open conversation. */
  conversationId: string;
  /** Its title, which the conversion suggests as the project name. */
  conversationTitle: string | undefined;
  /** The conversation's cards; only adopted ones are copied. */
  cards: readonly { id: string; content: string; adopted: boolean }[];
  /** Show a notice under the conversation. */
  notify(message: string): void;
}

/** Props of the inspiration space. */
export interface InspirationSpaceProps extends InspirationRemotes {
  t: Translate;
  title: string;
  description: string;
  /** The project conversion panel of the open conversation. */
  renderConversion: (props: InspirationConversionProps) => ReactNode;
}

function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORED_CONVERSATION);
  } catch {
    return null;
  }
}

function writeStored(id: string | undefined) {
  try {
    if (id) window.localStorage.setItem(STORED_CONVERSATION, id);
    else window.localStorage.removeItem(STORED_CONVERSATION);
  } catch {
    // The choice is a convenience; the space works without storage.
  }
}

/**
 * The inspiration space: creative conversations that bind no project, in
 * five modes, beside the corpus, the creative lab, the fingerprint, the
 * conversation's cards and the memory center. Web search and cross-chat
 * learning each ask for consent first.
 */
export function InspirationSpace(props: InspirationSpaceProps) {
  const { t, agents, system } = props;
  const remotes: InspirationRemotes = props;
  const dialog = useDialog(t);
  const [engines, setEngines] = useState<SpaceEngine[]>([]);
  const [webConsented, setWebConsented] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [archivedCount, setArchivedCount] = useState(0);
  const [conversationId, setConversationId] = useState<string>();
  const [detail, setDetail] = useState<AssistantDetail>();
  const [mode, setMode] = useState<CreativeMode>("free");
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [corpusQuery, setCorpusQuery] = useState("");
  const [outcomes, setOutcomes] = useState<Outcomes>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [webAccess, setWebAccess] = useState<WebAccessMode>("auto");
  const askedMemoryConsent = useRef(false);
  const run = activeRun(detail);
  const engine =
    engines.find((entry) => entry.isDefault && entry.canRun) ??
    engines.find((entry) => entry.canRun);

  const visible = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase();
    return keyword
      ? conversations.filter((item) =>
          (item.title ?? t("space.untitled"))
            .toLocaleLowerCase()
            .includes(keyword),
        )
      : conversations;
  }, [conversations, search, t]);

  const loadConversations = async (preferredId?: string) => {
    const [current, archived] = await Promise.all([
      value<ConversationSummary[]>(
        agents.assistantConversationsList({ surface: "inspiration" }),
      ),
      value<ConversationSummary[]>(
        agents.assistantConversationsList({
          surface: "inspiration",
          archived: "true",
        }),
      ),
    ]);
    setConversations(current);
    setArchivedCount(archived.length);
    const stored = readStored();
    const next =
      preferredId ??
      (stored && current.some((item) => item.id === stored)
        ? stored
        : current[0]?.id);
    if (next) setConversationId(next);
  };

  const loadDetail = async (id: string) => {
    const next = await value<AssistantDetail>(
      agents.assistantConversationsGet(id),
    );
    setDetail(next);
    setConversations((items) =>
      items.map((item) =>
        item.id === id ? { ...item, title: next.conversation.title } : item,
      ),
    );
    setMode(creativeMode(next.conversation.creativeMode));
    setWebAccess(next.conversation.webAccessMode);
  };

  const loadOutcomes = async (id: string | undefined) =>
    setOutcomes(await readOutcomes(remotes, id, corpusQuery));

  const patchOutcomes = (patch: Partial<Outcomes>) =>
    setOutcomes((current) => (current ? { ...current, ...patch } : current));

  const updateConversation = (id: string, input: Record<string, unknown>) =>
    value<AssistantConversation>(
      agents.assistantConversationsUpdate(
        id,
        input as never,
        undefined,
        undefined,
      ),
    );

  useEffect(() => {
    void value<SpaceEngine[]>(agents.enginesList()).then(
      setEngines,
      () => undefined,
    );
    void value<{ consented: boolean }>(
      agents.assistantWebResearchSettingsGet(),
    ).then(
      (settings) => setWebConsented(settings.consented),
      () => undefined,
    );
    void loadConversations().catch((cause) => setNotice(messageOf(cause)));
  }, [agents]);

  useEffect(() => {
    if (!conversationId) {
      setDetail(undefined);
      void loadOutcomes(undefined).catch(() => undefined);
      return;
    }
    writeStored(conversationId);
    void Promise.all([
      loadDetail(conversationId),
      loadOutcomes(conversationId),
    ]).catch((cause) => setNotice(messageOf(cause)));
  }, [conversationId]);

  useEffect(() => {
    if (!run || !conversationId) return;
    const timer = window.setInterval(() => {
      void loadDetail(conversationId).catch(() => undefined);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [conversationId, run?.id]);

  const settings = outcomes?.settings;
  useEffect(() => {
    if (!settings || settings.consentedAt || askedMemoryConsent.current) return;
    askedMemoryConsent.current = true;
    void dialog.confirm(t("space.memory.consent")).then(async (enabled) => {
      const next = await value<Outcomes["settings"]>(
        agents.inspirationMemorySettingsUpdate(
          { enabled },
          undefined,
          undefined,
        ),
      );
      patchOutcomes({ settings: next });
    });
  }, [settings]);

  usePublishedEvents(system, (event) => {
    if (
      event.type === "agents.assistant-session-updated.v1" &&
      event.payload &&
      typeof event.payload === "object"
    ) {
      const updated = event.payload as Record<string, unknown>;
      if (typeof updated.title === "string")
        setConversations((items) =>
          items.map((item) =>
            item.id === updated.sessionId
              ? { ...item, title: updated.title as string }
              : item,
          ),
        );
    }
    if (!conversationId || !event.payload || typeof event.payload !== "object")
      return;
    const payload = event.payload as Record<string, unknown>;
    if (
      payload.sessionId === conversationId ||
      payload.conversationId === conversationId
    )
      void loadDetail(conversationId).catch(() => undefined);
    if (event.type === MEMORY_COMPLETED)
      void loadOutcomes(conversationId).catch(() => undefined);
  });

  const newConversation = () => {
    setConversationId(undefined);
    setDetail(undefined);
    setMode("free");
    setWebAccess("auto");
    setDraft("");
    setNotice(undefined);
    writeStored(undefined);
  };

  const askWebConsent = async () => {
    if (webConsented) return true;
    const consented = await dialog.confirm(t("space.web.consent"));
    const updated = await value<{ consented: boolean }>(
      agents.assistantWebResearchSettingsUpdate(
        { consented },
        undefined,
        undefined,
      ),
    );
    setWebConsented(updated.consented);
    return updated.consented;
  };

  const changeWebAccess = async (next: WebAccessMode) => {
    if (run) return;
    try {
      const allowed = next === "auto" ? await askWebConsent() : false;
      const effective = next === "auto" && allowed ? "auto" : "off";
      setWebAccess(effective);
      if (conversationId) {
        const updated = await updateConversation(conversationId, {
          webAccessMode: effective,
        });
        setDetail((current) =>
          current ? { ...current, conversation: updated } : current,
        );
        await loadConversations(conversationId);
      }
      if (next === "auto" && !allowed) setNotice(t("space.web.kept"));
    } catch (cause) {
      setNotice(messageOf(cause));
    }
  };

  const ensureConversation = async (
    requested: WebAccessMode,
  ): Promise<AssistantConversation> => {
    const current = detail?.conversation;
    if (current && creativeMode(current.creativeMode) === mode) {
      if (current.webAccessMode === requested) return current;
      const updated = await updateConversation(current.id, {
        webAccessMode: requested,
      });
      setDetail({ ...detail, conversation: updated });
      return updated;
    }
    if (current) {
      const updated = await updateConversation(current.id, {
        creativeMode: mode,
      });
      setDetail({ ...detail, conversation: updated });
      return updated;
    }
    if (!engine) throw new Error(t("space.engine.none"));
    const created = await value<AssistantConversation>(
      agents.assistantConversationsCreate(
        {
          surface: "inspiration",
          creativeMode: mode,
          engineKind: engine.kind,
          webAccessMode: requested,
        },
        undefined,
        undefined,
      ),
    );
    setConversationId(created.id);
    setDetail({ conversation: created, turns: [], runs: [], items: [] });
    await loadConversations(created.id);
    return created;
  };

  const send = async (starter?: string) => {
    const content = (starter ?? draft).trim();
    if (!content || busy || run) return;
    setBusy(true);
    setNotice(undefined);
    try {
      let effective = webAccess;
      if (effective === "auto" && !(await askWebConsent())) {
        effective = "off";
        setWebAccess("off");
      }
      const conversation = await ensureConversation(effective);
      await value(
        agents.assistantConversationsSendMessage(
          conversation.id,
          { message: content },
          undefined,
          crypto.randomUUID(),
        ),
      );
      setDraft("");
      await Promise.all([
        loadDetail(conversation.id),
        loadConversations(conversation.id),
      ]);
    } catch (cause) {
      setNotice(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  const guard = (action: () => Promise<void>) => () =>
    void action().catch((cause) => setNotice(messageOf(cause)));

  const rename = guard(async () => {
    if (!conversationId || !detail) return;
    const answer = await dialog.form({
      title: t("space.rename.title"),
      fields: [
        {
          name: "title",
          label: t("space.rename.field"),
          kind: "text",
          initial: detail.conversation.title ?? t("space.untitled"),
        },
      ],
    });
    if (!answer?.title) return;
    await updateConversation(conversationId, { title: answer.title });
    await Promise.all([
      loadDetail(conversationId),
      loadConversations(conversationId),
    ]);
  });

  const fork = guard(async () => {
    if (!conversationId) return;
    const created = await value<{ id: string }>(
      agents.sessionsFork(conversationId, undefined, undefined, undefined),
    );
    await loadConversations(created.id);
    setConversationId(created.id);
    setNotice(t("space.fork.done"));
  });

  const archive = guard(async () => {
    if (!conversationId) return;
    await updateConversation(conversationId, { archived: true });
    newConversation();
    await loadConversations();
  });

  const remove = guard(async () => {
    if (!conversationId || !(await dialog.confirm(t("space.remove.confirm"))))
      return;
    await value(
      agents.assistantConversationsRemove(conversationId, undefined, undefined),
    );
    newConversation();
    await Promise.all([loadConversations(), loadOutcomes(undefined)]);
  });

  const modeName = (id: string | undefined) =>
    t(`space.mode.${creativeMode(id)}.name`);

  return (
    <div className={css.space}>
      <aside className={css.list} aria-label={t("space.list.aria")}>
        <div>
          <h1 className={css.title}>{props.title}</h1>
          <p className={css.lead}>{props.description}</p>
        </div>
        <Button variant="primary" onClick={newConversation}>
          {t("space.new")}
        </Button>
        <input
          className={css.input}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("space.search")}
          aria-label={t("space.search")}
        />
        <div className={css.conversations}>
          {visible.map((item) => (
            <button
              key={item.id}
              type="button"
              className={clsx(
                css.conversation,
                conversationId === item.id && css.conversationOn,
              )}
              onClick={() => setConversationId(item.id)}
            >
              <span className={css.ellipsis}>
                {item.title ?? t("space.untitled")}
              </span>
              <span className={css.small}>{modeName(item.creativeMode)}</span>
            </button>
          ))}
          {archivedCount > 0 && (
            <p className={css.small}>
              {t("space.archived", { count: archivedCount })}
            </p>
          )}
        </div>
      </aside>

      <section className={css.chat}>
        <header className={css.chatHead}>
          <div>
            <p className={css.strong}>
              {detail?.conversation.title ?? t("space.chat.new")}
            </p>
            <p className={css.small}>{t("space.chat.lead")}</p>
          </div>
          <div className={css.row}>
            <Button size="sm" onClick={rename} disabled={!conversationId}>
              {t("space.rename")}
            </Button>
            <Button size="sm" onClick={fork} disabled={!conversationId}>
              {t("space.fork")}
            </Button>
            <Button size="sm" onClick={archive} disabled={!conversationId}>
              {t("space.archive")}
            </Button>
            <Button
              size="sm"
              className={css.danger}
              onClick={remove}
              disabled={!conversationId}
            >
              {t("space.remove")}
            </Button>
          </div>
        </header>
        <div className={css.modesBar}>
          <div
            role="tablist"
            aria-label={t("space.mode.aria")}
            className={css.modes}
          >
            {MODES.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={mode === id}
                className={clsx(css.mode, mode === id && css.modeOn)}
                onClick={() => setMode(id)}
                title={t("space.mode.hint", {
                  name: t(`space.mode.${id}.name`),
                  description: t(`space.mode.${id}.description`),
                })}
              >
                {t(`space.mode.${id}.name`)}
              </button>
            ))}
          </div>
          <p className={css.modeHint}>{t(`space.mode.${mode}.description`)}</p>
        </div>
        <div className={css.messages}>
          {!detail?.turns.length && (
            <button
              type="button"
              className={css.starter}
              onClick={() => void send(t(`space.mode.${mode}.starter`))}
            >
              {t(`space.mode.${mode}.starter`)}
            </button>
          )}
          <AssistantTimeline
            t={t}
            detail={detail}
            surface="inspiration"
            onOpenUrl={(url) => void value(system.openExternal(url))}
          />
        </div>
        <footer className={css.composer}>
          {notice && <p className={css.notice}>{notice}</p>}
          <textarea
            className={css.draft}
            value={draft}
            aria-label={t("space.draft")}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey))
                void send();
            }}
            placeholder={t("space.draft.placeholder")}
          />
          <div className={css.composerRow}>
            <div className={css.row}>
              <WebAccessSwitch
                t={t}
                mode={webAccess}
                disabled={Boolean(run)}
                onChange={(next) => void changeWebAccess(next)}
              />
              <span className={css.ellipsis}>{t("space.send.hint")}</span>
            </div>
            <div className={css.row}>
              {run && (
                <Button
                  variant="outline"
                  onClick={() =>
                    void value(
                      agents.sessionsInterrupt(
                        run.id,
                        undefined,
                        undefined,
                        undefined,
                      ),
                    ).catch((cause) => setNotice(messageOf(cause)))
                  }
                >
                  {t("space.stop")}
                </Button>
              )}
              <Button
                variant="primary"
                disabled={busy || Boolean(run) || !draft.trim()}
                onClick={() => void send()}
              >
                {busy ? t("space.sending") : t("space.send")}
              </Button>
            </div>
          </div>
        </footer>
      </section>

      <SidePanels
        {...remotes}
        t={t}
        dialog={dialog}
        conversationId={conversationId}
        conversationTitle={detail?.conversation.title}
        draft={draft}
        outcomes={outcomes}
        patch={patchOutcomes}
        corpusQuery={corpusQuery}
        setCorpusQuery={setCorpusQuery}
        notify={setNotice}
        renderConversion={props.renderConversion}
      />
      {dialog.dialog}
    </div>
  );
}
