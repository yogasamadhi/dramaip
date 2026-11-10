/**
 * Transitional (P6, deleted with the `/api/v2` fakes): the insights measures
 * walk every page of a ledger inside the Host, so a `page.route` fake of one
 * `/api/v2` page never reaches them. While a suite routes requests, a held
 * measure call is answered here instead: the same `outcomeMeasures` walk runs
 * in the test process over single-page reads, each dispatched as its own
 * Remote call through the suite's handlers and, unhandled, to the Host.
 */
import { outcomeMeasures } from "../../packages/insights/insights/src/measures";
import type { WireRequest, WireResponse } from "./legacy-remote-routes";

/** The measure calls the Host composes from single-page reads. */
export const compositeRemotePattern =
  /\/api\/insights\/(deliveryCoverage|deliveryWindow|configurationFunnel|revisionEffortResult|revisionConfigurations|executionList|executionDetail)$/u;

/** The whole-ledger measures, by the Remote method that answers each. */
const WHOLE = {
  deliveryCoverage: "deliveryCoverage",
  deliveryWindow: "deliveryWindow",
  configurationFunnel: "configurationFunnel",
  revisionEffortResult: "revisionEffort",
  revisionConfigurations: "revisionConfigurations",
} as const;

/** One Remote call's result envelope. */
type Result =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string; details?: unknown } };

/** A single-page read the suite answered with a failure. */
class ReadFailure extends Error {
  constructor(readonly failure: Extract<Result, { ok: false }>["error"]) {
    super(failure.message);
  }
}

const text = (base64: string) => Buffer.from(base64, "base64").toString("utf8");
const base64 = (value: string) => Buffer.from(value).toString("base64");

/**
 * The Remote request for one single-page read, sent from where the held
 * measure call was.
 * @param held - the held measure call.
 * @param endpoint - `<namespace>/<method>`.
 * @param args - the read's arguments by parameter name.
 */
export function remoteRequest(
  held: WireRequest,
  endpoint: string,
  args: Record<string, unknown>,
): WireRequest {
  return {
    url: new URL(`/api/${endpoint}`, held.url).href,
    method: "POST",
    headers: { ...held.headers, "content-type": "application/json" },
    body: base64(
      JSON.stringify({
        type: "client-request",
        rpcId: crypto.randomUUID(),
        method: endpoint,
        payload: { args },
      }),
    ),
  };
}

/**
 * Answer a held measure call by running the measure over `read`.
 * @param held - the held call.
 * @param read - one single-page read as a Remote request, answered as the
 *   Remote response.
 * @returns the measure's Remote response, or undefined when `held` is not a
 *   measure call.
 */
export async function answerComposite(
  held: WireRequest,
  read: (request: WireRequest) => Promise<WireResponse>,
): Promise<WireResponse | undefined> {
  const method = compositeRemotePattern.exec(new URL(held.url).pathname)?.[1];
  if (method === undefined || held.body === undefined) return undefined;
  const envelope = JSON.parse(text(held.body)) as {
    rpcId: string;
    payload?: { args?: Record<string, unknown> };
  };
  const args = envelope.payload?.args ?? {};
  const call = async (endpoint: string, readArgs: Record<string, unknown>) => {
    const response = await read(remoteRequest(held, endpoint, readArgs));
    const answered = JSON.parse(text(response.body)) as { result?: Result };
    if (answered.result === undefined)
      throw new Error(`${endpoint} answered ${response.status}`);
    if (!answered.result.ok) throw new ReadFailure(answered.result.error);
    return answered.result.value;
  };
  const measures = outcomeMeasures({
    outcomeSummary: (projectId) =>
      call("insights/outcomeSummary", { projectId }),
    outcomes: (projectId, query) =>
      call("insights/outcomes", { projectId, query }),
    executions: (projectId, query) =>
      call("insights/executions", { projectId, query }),
    execution: (projectId, workflowId, query) =>
      call("insights/execution", { projectId, workflowId, query }),
    revisionEffort: (projectId, query) =>
      call("insights/revisionEffort", { projectId, query }),
  });
  const projectId = String(args.projectId);
  const cursor = (args.query as { cursor?: number } | undefined)?.cursor;
  let result: Result;
  try {
    const value =
      method === "executionList"
        ? await measures.executionList(projectId, cursor)
        : method === "executionDetail"
          ? await measures.executionDetail(
              projectId,
              String(args.workflowId),
              cursor,
            )
          : await measures[WHOLE[method as keyof typeof WHOLE]](projectId);
    result = { ok: true, value };
  } catch (error) {
    result = {
      ok: false,
      error:
        error instanceof ReadFailure
          ? error.failure
          : {
              code: "gateway/internal",
              message: error instanceof Error ? error.message : String(error),
              details: {},
            },
    };
  }
  return {
    status: 200,
    headers: { "content-type": "application/json" },
    body: base64(
      JSON.stringify({
        type: "server-response",
        rpcId: envelope.rpcId,
        result,
      }),
    ),
  };
}
