import { useState, type MouseEvent } from "react";
import type { Context } from "@deepseek-ai/cordis";
import { Button, Input } from "@dramaip/infra-ui-primitives";
import type { PropsLocale, PropsRuntime } from "@dramaip/infra-ui-slots";
import type { SearchGlobalResult } from "@dramaip/workspace-workspace/types";
import type {} from "@dramaip/workspace-workspace/remote";
import type {} from "@dramaip/workspace-studio-client/client/contract";
import { zh } from "./locale.ts";
import css from "./SearchPage.module.css";

type SearchHit = SearchGlobalResult["results"][number];
type KindKey = Extract<keyof typeof zh, `kind.${string}`>;

/** The copy key naming a hit's kind; an unlisted kind reads as a resource. */
const kindKey = (kind: string): KindKey =>
  `kind.${kind}` in zh ? (`kind.${kind}` as KindKey) : "kind.other";

/** Full component props of the `/search` page. */
export type SearchPageProps = PropsRuntime<"studio.route"> &
  PropsLocale<"workspace"> & {
    workspace: Context["remote"]["workspace"];
  };

const STAGE_IDS: Partial<Record<string, string>> = {
  adaptations: "adaptationId",
  episodes: "episodeId",
  scripts: "scriptId",
  scenes: "sceneId",
  shots: "shotId",
};
const PRODUCE_KINDS = new Set([
  "assets",
  "rights",
  "visual-assets",
  "shot-stills",
  "image",
  "audio",
  "video",
  "animatics",
  "renders",
]);
const REVIEW_KINDS = new Set([
  "quality",
  "compliance",
  "localization",
  "review",
  "delivery",
]);
const SETTINGS_KINDS = new Set([
  "providers",
  "settings",
  "backup",
  "cloud",
  "agents",
]);

/**
 * The app path a search hit opens: its project, the workspace stage that
 * holds it, or the settings.
 */
export function searchHitPath(
  hit: Pick<SearchHit, "kind" | "id" | "projectId">,
) {
  const { kind, id, projectId } = hit;
  if (kind === "project") return `/projects/${id}`;
  if (kind === "chapter" && projectId) return `/projects/${projectId}`;
  const stage = (path: string, idKey?: string) => {
    const search = new URLSearchParams({ stage: kind });
    if (projectId) search.set("projectId", projectId);
    if (idKey) search.set(idKey, id);
    return `${path}?${search}`;
  };
  if (kind in STAGE_IDS) return stage("/adapt", STAGE_IDS[kind]);
  if (PRODUCE_KINDS.has(kind)) return stage("/produce");
  if (REVIEW_KINDS.has(kind)) return stage("/review");
  if (SETTINGS_KINDS.has(kind)) return "/settings";
  return "/create";
}

/** Search projects, chapters and project material, and open a hit. */
export function SearchPage({ t, navigate, workspace }: SearchPageProps) {
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<SearchGlobalResult>();
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string>();
  const search = async () => {
    const text = query.trim();
    if (!text) return;
    setSearching(true);
    setError(undefined);
    const result = await workspace.searchGlobal(text);
    setSearching(false);
    if (result.ok) setAnswer(result.value);
    else setError(result.error.message);
  };
  return (
    <section className={css.page}>
      <header className={css.header}>
        <h1 className={css.title}>{t("search.title")}</h1>
        <p className={css.muted}>{t("search.description")}</p>
      </header>
      <div className={css.bar}>
        <span className={css.input}>
          <Input
            aria-label={t("search.label")}
            placeholder={t("search.placeholder")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void search();
            }}
          />
        </span>
        <Button
          variant="primary"
          disabled={!query.trim() || searching}
          onClick={() => void search()}
        >
          {searching ? t("search.searching") : t("search.submit")}
        </Button>
      </div>
      {error !== undefined && (
        <p role="alert" className={css.error}>
          {t("search.failed", { message: error })}
        </p>
      )}
      {answer?.query ? (
        <p className={css.muted}>
          {t("search.count", {
            query: answer.query,
            count: answer.results.length,
          })}
        </p>
      ) : null}
      <div className={css.results}>
        {answer?.results.map((hit) => {
          const to = searchHitPath(hit);
          return (
            <a
              key={`${hit.kind}-${hit.id}`}
              className={css.hit}
              href={to}
              onClick={(event: MouseEvent) => {
                event.preventDefault();
                navigate(to);
              }}
            >
              <span className={css.hitHead}>
                <span className={css.hitTitle}>{hit.title}</span>
                <span className={css.kind}>{t(kindKey(hit.kind))}</span>
              </span>
              {hit.excerpt &&
                (hit.kind === "project" || hit.kind === "chapter") && (
                  <span className={css.excerpt}>{hit.excerpt}</span>
                )}
            </a>
          );
        })}
        {answer?.query && answer.results.length === 0 ? (
          <p className={css.empty}>{t("search.empty")}</p>
        ) : null}
      </div>
    </section>
  );
}
