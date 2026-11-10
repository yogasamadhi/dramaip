// @vitest-environment jsdom
import type { TranslateNS } from "@dramaip/infra-ui-slots";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExecutionsPanel } from "../src/client/ExecutionsPanel.tsx";
import {
  ConfigurationFunnelPanel,
  DeliveryCoveragePanel,
  RevisionEffortPanel,
} from "../src/client/MeasurePanels.tsx";
import {
  OutcomesSection,
  type OutcomesSectionProps,
} from "../src/client/OutcomesSection.tsx";
import { UsageObservations } from "../src/client/UsageObservations.tsx";
import { outcomesEn, outcomesZh } from "../src/client/outcomes-locale.ts";

afterEach(cleanup);

/** Copy with its key and parameters visible, so assertions name the key. */
const t = ((key: string, params?: Record<string, unknown>) =>
  params
    ? `${key}(${JSON.stringify(params)})`
    : key) as unknown as TranslateNS<"insights">;

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });
const failed = (message: string) =>
  Promise.resolve({
    ok: false as const,
    error: { code: "compat/problem", message },
  });
const never = () => new Promise<never>(() => {});

const PROJECT = "11111111-1111-4111-8111-111111111111";
const WORKFLOW = "44444444-4444-4444-8444-444444444444";
const projection = { checkpoint: 7, state: "healthy" };

/** The section's props as its slot hands them over. */
const section = (projectId: string, insights: object) =>
  ({
    projectId,
    revisionClusterId: undefined,
    insights,
    agents: {},
    t,
  }) as unknown as OutcomesSectionProps;

const click = async (text: string) => {
  await act(async () => {
    fireEvent.click(screen.getByText(text));
  });
};

describe("outcome ledger copy", () => {
  it("names every key in both languages with the same parameters", () => {
    const names = (text: string) =>
      [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    expect(Object.keys(outcomesEn).sort()).toEqual(
      Object.keys(outcomesZh).sort(),
    );
    for (const [key, text] of Object.entries(outcomesZh))
      expect(names(outcomesEn[key as keyof typeof outcomesEn]), key).toEqual(
        names(text),
      );
  });
});

describe("the outcomes section", () => {
  it("renders nothing before a project is chosen", () => {
    const insights = { outcomeSummary: vi.fn() };
    const { container } = render(
      <OutcomesSection {...section("", insights)} />,
    );
    expect(container.innerHTML).toBe("");
    expect(insights.outcomeSummary).not.toHaveBeenCalled();
  });

  it("reads the summary, the first receipts and the continuation cohort, and names a failed read", async () => {
    const insights = {
      continuationSummary: vi.fn(() => never()),
      outcomeSummary: vi.fn(() => failed("台账损坏")),
      outcomes: vi.fn(() => never()),
    };
    await act(async () => {
      render(<OutcomesSection {...section(PROJECT, insights)} />);
    });
    expect(insights.continuationSummary).toHaveBeenCalledWith();
    expect(insights.outcomeSummary).toHaveBeenCalledWith(PROJECT);
    expect(insights.outcomes).toHaveBeenCalledWith(PROJECT, { limit: 25 });
    expect(screen.getByRole("alert").textContent).toBe(
      `outcomes.error(${JSON.stringify({ error: "台账损坏" })})`,
    );
    expect(screen.queryByText("outcomes.receipt.empty")).toBeNull();
  });
});

describe("the request and run ledger", () => {
  const detail = {
    operation: "chapter",
    statistics: { state: "missing" },
    execution: {
      workflowId: WORKFLOW,
      request: {
        record: {
          eventId: "event-1",
          fact: {
            kind: "request",
            targetAttempt: 1,
            requestKind: "initial",
            requestedAt: "2026-10-30T00:00:00.000Z",
          },
        },
      },
      projection,
      facts: { items: [] },
      execution: { state: "read-failed" },
    },
  };

  it("reads nothing until asked, then one workflow once the author picks it", async () => {
    const insights = {
      executionList: vi.fn(() =>
        ok({
          projection,
          items: [{ record: { fact: { workflowId: WORKFLOW } } }],
          operations: { [WORKFLOW]: "chapter" },
        }),
      ),
      executionDetail: vi.fn(() => ok(detail)),
    };
    render(
      <ExecutionsPanel
        insights={insights as never}
        agents={{} as never}
        projectId={PROJECT}
        t={t}
      />,
    );
    expect(insights.executionList).not.toHaveBeenCalled();
    await click("outcomes.exec.read");
    expect(insights.executionList).toHaveBeenCalledWith(PROJECT, {});
    await click(
      `outcomes.exec.item(${JSON.stringify({ workflowId: WORKFLOW, operation: "chapter" })})`,
    );
    expect(insights.executionDetail).toHaveBeenCalledWith(
      PROJECT,
      WORKFLOW,
      {},
    );
    expect(screen.getByText("outcomes.exec.state.readFailed")).toBeTruthy();
    expect(
      screen.getByText(
        `outcomes.exec.stats.none(${JSON.stringify({ state: "outcomes.exec.state.missing" })})`,
      ),
    ).toBeTruthy();
  });

  it("names a failed request read instead of showing no requests", async () => {
    const insights = { executionList: vi.fn(() => failed("投影损坏")) };
    render(
      <ExecutionsPanel
        insights={insights as never}
        agents={{} as never}
        projectId={PROJECT}
        t={t}
      />,
    );
    await click("outcomes.exec.read");
    expect(screen.getByRole("alert").textContent).toBe(
      `outcomes.exec.error(${JSON.stringify({ error: "投影损坏" })})`,
    );
    expect(screen.queryByText("outcomes.exec.empty")).toBeNull();
  });
});

describe("the measure panels", () => {
  it("reads the configuration funnel on request and shows no group as unrecorded", async () => {
    const insights = {
      configurationFunnel: vi.fn(() =>
        ok({
          projection,
          recordedWorkflows: 0,
          recordedTargets: 0,
          groups: [],
        }),
      ),
    };
    render(
      <ConfigurationFunnelPanel
        insights={insights as never}
        projectId={PROJECT}
        t={t}
      />,
    );
    expect(insights.configurationFunnel).not.toHaveBeenCalled();
    await click("outcomes.funnel.read");
    expect(insights.configurationFunnel).toHaveBeenCalledWith(PROJECT);
    expect(screen.getByText("outcomes.funnel.empty")).toBeTruthy();
  });

  it("shows one revision answer at a time, plain or grouped", async () => {
    const insights = {
      revisionEffortResult: vi.fn(() =>
        ok({ projectId: PROJECT, projection, totalTargets: 0, items: [] }),
      ),
      revisionConfigurations: vi.fn(() =>
        ok({
          projectId: PROJECT,
          projection,
          recordedTargets: 0,
          recordedWorkflows: 0,
          groups: [],
        }),
      ),
    };
    render(
      <RevisionEffortPanel
        insights={insights as never}
        projectId={PROJECT}
        t={t}
      />,
    );
    await click("outcomes.revision.read");
    expect(insights.revisionEffortResult).toHaveBeenCalledWith(PROJECT);
    expect(screen.getByText("outcomes.revision.empty")).toBeTruthy();
    await click("outcomes.revision.readGrouped");
    expect(insights.revisionConfigurations).toHaveBeenCalledWith(PROJECT);
    expect(screen.getByText("outcomes.revision.grouped.empty")).toBeTruthy();
    expect(screen.queryByText("outcomes.revision.empty")).toBeNull();
  });

  it("keeps the delivery ratio exact and drops a read the author stops", async () => {
    const insights = {
      deliveryCoverage: vi.fn(() =>
        ok({
          projection,
          groups: [
            {
              workflowPath: "novel",
              adoptedVersions: 2,
              deliveredVersions: 1,
              notSavedVersions: 1,
              ratio: { numerator: 1, denominator: 2 },
              savedVersionsWithoutEarlierAdoption: [],
              items: [],
            },
          ],
        }),
      ),
      deliveryWindow: vi.fn(() => never()),
    };
    render(
      <DeliveryCoveragePanel
        insights={insights as never}
        projectId={PROJECT}
        t={t}
      />,
    );
    await click("outcomes.delivery.read");
    expect(insights.deliveryCoverage).toHaveBeenCalledWith(PROJECT);
    expect(
      screen.getByText(
        `outcomes.delivery.coverage.ratio(${JSON.stringify({ numerator: 1, denominator: 2 })})`,
      ),
    ).toBeTruthy();
    await click("outcomes.delivery.readWindow");
    expect(insights.deliveryWindow).toHaveBeenCalledWith(PROJECT);
    expect(screen.getByText("outcomes.delivery.pending")).toBeTruthy();
    await click("outcomes.delivery.stop");
    expect(screen.queryByText("outcomes.delivery.pending")).toBeNull();
    expect(screen.queryByText("outcomes.delivery.coverage.result")).toBeNull();
  });
});

describe("a run's usage reports", () => {
  it("refuses a report from another session instead of showing it", async () => {
    const agents = {
      agentUsageObservationsList: vi.fn(() =>
        ok({
          runId: "run-1",
          projectId: PROJECT,
          observationCount: 1,
          items: [{ cursor: 1, sessionId: "other", engineKind: "pi" }],
        }),
      ),
    };
    render(
      <UsageObservations
        agents={agents as never}
        t={t}
        runId="run-1"
        projectId={PROJECT}
        expectedSessionId="session-1"
        expectedEngineKind="pi"
      />,
    );
    await click("outcomes.usage.load.first");
    expect(agents.agentUsageObservationsList).toHaveBeenCalledWith("run-1", {
      projectId: PROJECT,
      limit: 25,
    });
    expect(screen.getByRole("alert").textContent).toBe(
      `outcomes.usage.error(${JSON.stringify({ error: "outcomes.usage.foreign" })})`,
    );
    expect(screen.queryByLabelText("outcomes.usage.aria")).toBeNull();
  });
});
