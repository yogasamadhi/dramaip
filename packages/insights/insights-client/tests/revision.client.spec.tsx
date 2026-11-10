// @vitest-environment jsdom
import type { RenderFactorySlot, TranslateNS } from "@dramaip/infra-ui-slots";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RevisionSection,
  type RevisionSectionProps,
} from "../src/client/RevisionSection.tsx";

afterEach(cleanup);

const t = ((key: string, params?: Record<string, unknown>) =>
  params
    ? `${key}(${JSON.stringify(params)})`
    : key) as unknown as TranslateNS<"insights">;
const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });

const PROJECT = "11111111-1111-4111-8111-111111111111";

function mount(revisionClusterId: string | undefined) {
  const writing = {
    chaptersList: vi.fn(() =>
      ok([
        { id: "c-1", title: "第一章", projectId: PROJECT, version: 4 },
        { id: "c-x", title: "别处", projectId: "other", version: 1 },
      ]),
    ),
  };
  const production = {
    scriptsList: vi.fn(() =>
      ok([{ id: "s-1", title: "剧本一", projectId: PROJECT, version: 2 }]),
    ),
  };
  const renderFactorySlot = vi.fn((name: string) => (
    <span>{name}</span>
  )) as unknown as RenderFactorySlot;
  const props = {
    projectId: PROJECT,
    revisionClusterId,
    writing,
    production,
    renderFactorySlot,
    t,
  } as unknown as RevisionSectionProps;
  render(<RevisionSection {...props} />);
  return { writing, production, renderFactorySlot };
}

const choose = async (value: string) => {
  await act(async () => {
    fireEvent.change(screen.getByLabelText("revision.target"), {
      target: { value },
    });
  });
};

describe("the feedback revision section", () => {
  it("renders nothing until a cluster is chosen", () => {
    const { writing } = mount(undefined);
    expect(screen.queryByText("revision.title")).toBeNull();
    expect(writing.chaptersList).not.toHaveBeenCalled();
  });

  it("offers this project's chapters and scripts and drafts in the creation workbench", async () => {
    const { production, renderFactorySlot } = mount("cluster-1");
    await act(async () => {});
    expect(production.scriptsList).toHaveBeenCalledWith({
      projectId: PROJECT,
    });
    expect(screen.queryByText(/别处/u)).toBeNull();
    await choose("c-1");
    expect(renderFactorySlot).toHaveBeenLastCalledWith(
      "automation.creation-workbench",
      {
        projectId: PROJECT,
        operation: "chapter",
        targetId: "c-1",
        baseVersion: 4,
        feedbackClusterId: "cluster-1",
        defaultInstruction: "revision.chapterInstruction",
      },
    );
    await choose("s-1");
    expect(renderFactorySlot).toHaveBeenLastCalledWith(
      "automation.creation-record",
      {
        projectId: PROJECT,
        domain: "scripts",
        operation: "script-revision",
        targetId: "s-1",
        feedbackClusterId: "cluster-1",
        defaultInstruction: "revision.scriptInstruction",
      },
    );
  });
});
