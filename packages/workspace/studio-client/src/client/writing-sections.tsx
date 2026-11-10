import type { Context } from "@deepseek-ai/cordis";
import type { PropsRuntime } from "@dramaip/infra-ui-slots";
import {
  CREATIVE_SECTIONS,
  CreativeSectionBody,
  NOVEL_SECTIONS,
  NovelManuscriptDialog,
  NovelPresetPicker,
  NovelSectionBody,
  StoryPresetBanner,
  type CreativeSection,
  type NovelPresetRecord,
  type NovelSection,
  type NovelWorkspaceRecord,
} from "../app/writing-sections";
import type {} from "./contract.ts";

/** The body of one novel workspace section, over the page's record. */
function sectionBody(section: NovelSection) {
  return function SectionBody(props: PropsRuntime<"writing.section">) {
    return (
      <NovelSectionBody
        section={section}
        record={props.record as NovelWorkspaceRecord}
        outlineMode={props.outlineMode}
        open={props.open}
      />
    );
  };
}

function PresetBanner(props: PropsRuntime<"writing.banner">) {
  return (
    <StoryPresetBanner
      record={props.record as NovelWorkspaceRecord}
      outlineMode={props.outlineMode}
      open={props.open}
    />
  );
}

function ManuscriptDialog(props: PropsRuntime<"writing.manuscript">) {
  return (
    <NovelManuscriptDialog
      projectId={props.projectId}
      format={props.format}
      previewId={props.previewId}
      onSaved={props.onSaved}
      onClose={props.onClose}
    />
  );
}

function PresetPicker(props: PropsRuntime<"writing.preset">) {
  return <NovelPresetPicker record={props.record as NovelPresetRecord} />;
}

/** One creative analysis section, at its place in the page. */
function creativeSection(section: CreativeSection) {
  return function CreativeBody(props: PropsRuntime<"quality.section">) {
    return (
      <CreativeSectionBody
        section={section}
        projectId={props.projectId}
        changeSetId={props.changeSetId}
      />
    );
  };
}

/**
 * Register the writing panels the existing app still owns into the pages
 * the writing and quality clients declare: the novel workspace's sections,
 * its story preset banner and manuscript dialog, the quick start's preset
 * picker and the creative analysis sections. Transitional until the panels
 * move (P6).
 * @param ctx - Client Context whose Slot registry the pages declare into.
 */
export function registerLegacyWritingSections(ctx: Context): void {
  const registrant = "workspace-studio-client";
  ctx.slots.inject("writing.section", () =>
    NOVEL_SECTIONS.map((key) =>
      ctx.slots.register(
        { name: "writing.section", key, registrant },
        sectionBody(key),
      ),
    ),
  );
  ctx.slots.inject("writing.banner", () => [
    ctx.slots.register(
      {
        name: "writing.banner",
        id: "writing-story-preset",
        order: 10,
        registrant,
      },
      PresetBanner,
    ),
  ]);
  ctx.slots.inject("writing.manuscript", () => [
    ctx.slots.register(
      { name: "writing.manuscript", key: "dialog", registrant },
      ManuscriptDialog,
    ),
  ]);
  ctx.slots.inject("writing.preset", () => [
    ctx.slots.register(
      { name: "writing.preset", key: "picker", registrant },
      PresetPicker,
    ),
  ]);
  ctx.slots.inject("quality.section", () =>
    CREATIVE_SECTIONS.map((section, index) =>
      ctx.slots.register(
        {
          name: "quality.section",
          id: `quality-${section}`,
          order: (index + 1) * 10,
          registrant,
        },
        creativeSection(section),
      ),
    ),
  );
}
