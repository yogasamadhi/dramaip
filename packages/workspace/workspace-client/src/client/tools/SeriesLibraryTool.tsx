import clsx from "clsx";
import { useEffect, useState } from "react";
import { Button, Input } from "@dramaip/infra-ui-primitives";
import type { VisualAssetsListResult } from "@dramaip/production-media/types";
import type {
  ProjectsListResult,
  SeriesLibraryResult,
  SeriesListResult,
} from "@dramaip/workspace-workspace/types";
import type { ToolProps } from "./PersonalTheaterTool.tsx";
import { messageOf, value } from "./remote.ts";
import css from "./Tools.module.css";

type Setting = SeriesLibraryResult["storyBible"][number];
type TransferMode = "copy" | "fork" | "link";

/** What the library shows for one project. */
interface Library {
  series: SeriesListResult;
  library: SeriesLibraryResult;
  projects: ProjectsListResult;
}

/**
 * The series asset library of one project: join, leave or create a series,
 * add a series story bible setting and override it in the project, and
 * import a locked asset version from a project of the series as a copy, a
 * fork or an immutable link.
 */
export function SeriesLibraryTool(props: ToolProps) {
  const { projectId, workspace, media, t } = props;
  const [data, setData] = useState<Library>();
  const [revision, setRevision] = useState(0);
  const [newSeriesTitle, setNewSeriesTitle] = useState("");
  const [settingTitle, setSettingTitle] = useState("");
  const [settingJson, setSettingJson] = useState<string>(
    t("series.setting.default"),
  );
  const [sourceProjectId, setSourceProjectId] = useState(projectId);
  const [sourceAssets, setSourceAssets] = useState<VisualAssetsListResult>([]);
  const [sourceAssetId, setSourceAssetId] = useState("");
  const [notice, setNotice] = useState<string>();
  const [working, setWorking] = useState(false);
  useEffect(() => {
    let live = true;
    void Promise.all([
      value(workspace.seriesList()),
      value(workspace.seriesLibrary(projectId)),
      value(workspace.projectsList()),
    ]).then(
      ([series, library, projects]) =>
        live && setData({ series, library, projects }),
      (cause: unknown) => live && setNotice(messageOf(cause)),
    );
    return () => {
      live = false;
    };
  }, [workspace, projectId, revision]);
  useEffect(() => {
    let live = true;
    void value(media.visualAssetsList({ projectId: sourceProjectId })).then(
      (assets) => live && setSourceAssets(assets),
      (cause: unknown) => live && setNotice(messageOf(cause)),
    );
    return () => {
      live = false;
    };
  }, [media, sourceProjectId, revision]);
  const refresh = () => setRevision((current) => current + 1);
  /** Run one write; its failure becomes the notice. */
  const write = async (run: () => Promise<string>) => {
    setWorking(true);
    try {
      setNotice(await run());
      refresh();
    } catch (cause) {
      setNotice(messageOf(cause));
    } finally {
      setWorking(false);
    }
  };
  const setSeries = async (seriesId: string | undefined) => {
    await value(
      workspace.seriesSetProjectSeries(
        projectId,
        seriesId ? { seriesId } : {},
        undefined,
        undefined,
      ),
    );
    return t(seriesId ? "series.joined" : "series.left");
  };
  const createSeries = () => {
    const title = newSeriesTitle.trim();
    if (!title) return setNotice(t("series.name.missing"));
    void write(async () => {
      const created = await value(
        workspace.seriesCreate({ title }, undefined, undefined),
      );
      await setSeries(created.id);
      setNewSeriesTitle("");
      return t("series.created", { title: created.title });
    });
  };
  const createSetting = (seriesId: string) => {
    let payload: unknown;
    try {
      payload = JSON.parse(settingJson);
    } catch {
      return setNotice(t("series.setting.invalidJson"));
    }
    const title = settingTitle.trim();
    if (
      !title ||
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload)
    )
      return setNotice(t("series.setting.missing"));
    void write(async () => {
      const created = await value(
        workspace.seriesCreateStoryBible(
          seriesId,
          { title, payload: payload as never },
          undefined,
          undefined,
        ),
      );
      await value(
        workspace.seriesUpgradeStoryBible(
          projectId,
          created.id,
          { sourceVersion: created.version },
          undefined,
          undefined,
        ),
      );
      setSettingTitle("");
      return t("series.setting.created");
    });
  };
  const overrideSetting = (setting: Setting) =>
    void write(async () => {
      await value(
        workspace.seriesOverrideStoryBible(
          projectId,
          setting.id,
          {
            title: setting.title,
            ...(setting.payload === undefined
              ? {}
              : { payload: setting.payload }),
            sourceVersion: setting.sourceVersion,
          },
          undefined,
          undefined,
        ),
      );
      return t("series.setting.overridden");
    });
  const transfer = (mode: TransferMode) => {
    const asset = sourceAssets.find((item) => item.id === sourceAssetId);
    if (!asset) return setNotice(t("series.asset.missing"));
    void write(async () => {
      await value(
        workspace.seriesTransferAsset(
          projectId,
          { sourceAssetId: asset.id, sourceVersion: asset.version, mode },
          undefined,
          undefined,
        ),
      );
      return t(`series.asset.${mode}`);
    });
  };
  const current = data?.library.series;
  return (
    <section data-testid="series-library" className={css.panel}>
      <div className={css.head}>
        <div>
          <h2 className={css.heading}>{t("series.title")}</h2>
          <p className={css.muted}>{t("series.description")}</p>
        </div>
        <select
          aria-label={t("series.belongs")}
          className={css.select}
          value={current?.id ?? ""}
          disabled={working}
          onChange={(event) =>
            void write(() => setSeries(event.target.value || undefined))
          }
        >
          <option value="">{t("series.none")}</option>
          {data?.series.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
      </div>
      {!current ? (
        <div className={css.row}>
          <div className={css.grow}>
            <Input
              aria-label={t("series.new")}
              placeholder={t("series.new.placeholder")}
              value={newSeriesTitle}
              onChange={(event) => setNewSeriesTitle(event.target.value)}
            />
          </div>
          <Button variant="primary" disabled={working} onClick={createSeries}>
            {t("series.create")}
          </Button>
        </div>
      ) : (
        <>
          <p className={css.notice}>
            <span className={css.name}>
              {t("series.current", { title: current.title })}
            </span>{" "}
            <span className={css.muted}>
              {t("series.current.note", { version: current.version })}
            </span>
          </p>
          <div className={css.columns}>
            <div className={css.box}>
              <p className={css.name}>{t("series.bible")}</p>
              {data.library.storyBible.length ? (
                data.library.storyBible.map((setting) => (
                  <div key={setting.id} className={css.item}>
                    <div className={clsx(css.row, css.between)}>
                      <span>{setting.title}</span>
                      <Button
                        size="sm"
                        disabled={working || setting.overridden}
                        onClick={() => overrideSetting(setting)}
                      >
                        {t(
                          setting.overridden
                            ? "series.bible.overridden"
                            : "series.bible.override",
                        )}
                      </Button>
                    </div>
                    <p className={clsx(css.muted, css.small)}>
                      {t(
                        setting.overridden
                          ? "series.bible.source.own"
                          : "series.bible.source.inherited",
                        { version: setting.sourceVersion },
                      )}
                    </p>
                  </div>
                ))
              ) : (
                <p className={css.muted}>{t("series.bible.empty")}</p>
              )}
              <Input
                aria-label={t("series.setting.title")}
                placeholder={t("series.setting.placeholder")}
                value={settingTitle}
                onChange={(event) => setSettingTitle(event.target.value)}
              />
              <textarea
                aria-label={t("series.setting.json")}
                className={clsx(css.select, css.code)}
                value={settingJson}
                onChange={(event) => setSettingJson(event.target.value)}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={working}
                onClick={() => createSetting(current.id)}
              >
                {t("series.setting.create")}
              </Button>
            </div>
            <div className={css.box}>
              <p className={css.name}>{t("series.import")}</p>
              <select
                aria-label={t("series.source.project")}
                className={css.select}
                value={sourceProjectId}
                onChange={(event) => {
                  setSourceProjectId(event.target.value);
                  setSourceAssetId("");
                }}
              >
                {data.projects.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.seriesId === current.id
                      ? item.title
                      : t("series.source.outside", { title: item.title })}
                  </option>
                ))}
              </select>
              <select
                aria-label={t("series.source.asset")}
                className={css.select}
                value={sourceAssetId}
                onChange={(event) => setSourceAssetId(event.target.value)}
              >
                <option value="">{t("series.source.choose")}</option>
                {sourceAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {t("series.source.option", {
                      title: asset.title,
                      version: asset.version,
                    })}
                  </option>
                ))}
              </select>
              <div className={css.row}>
                {(["copy", "fork", "link"] as const).map((mode) => (
                  <Button
                    key={mode}
                    size="sm"
                    variant={mode === "link" ? "primary" : "outline"}
                    disabled={working}
                    onClick={() => transfer(mode)}
                  >
                    {t(`series.${mode}`)}
                  </Button>
                ))}
              </div>
              {data.library.assets.length ? (
                <p className={clsx(css.muted, css.small)}>
                  {t("series.imported", {
                    list: data.library.assets
                      .map((asset) =>
                        t("series.imported.item", {
                          mode: asset.mode,
                          version: asset.sourceVersion,
                        }),
                      )
                      .join("；"),
                  })}
                </p>
              ) : (
                <p className={css.muted}>{t("series.imported.empty")}</p>
              )}
            </div>
          </div>
        </>
      )}
      {notice && (
        <p role="status" className={css.notice}>
          {notice}
        </p>
      )}
    </section>
  );
}
