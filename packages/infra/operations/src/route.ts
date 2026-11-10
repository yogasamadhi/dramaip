/**
 * One route contribution, compiled: its path matcher, the validation of its
 * declared request parts and the {@link RouteContext} its handler receives.
 * @module @dramaip/infra-operations/route
 */

import { randomUUID } from "node:crypto";
import type {
  RouteContext,
  RouteContribution,
  RouteDeclaration,
  RouteRequest,
  RouteResponseHeaders,
  RouteResponseInit,
  RouteSchema,
} from "@dramaip/plugin-api/internal";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** A JSON media type, with or without a `+json` suffix and parameters. */
const JSON_TYPE =
  /^application\/([a-z-.]+\+)?json(;\s*[a-zA-Z0-9-]+=([^;]+))*$/iu;

/** A contribution ready to dispatch. */
export interface CompiledRoute {
  readonly contribution: RouteContribution;
  /** The decoded path parameters when `method` and `url` match, else undefined. */
  match(method: string, url: URL): Record<string, string> | undefined;
  /** Validators in the order they run: query, params, headers, cookies, body. */
  readonly validators: readonly Validator[];
}

type Validator = (request: RouteRequest) => Promise<boolean>;

function schemaOf(value: unknown): RouteSchema | undefined {
  return typeof (value as RouteSchema | undefined)?.safeParseAsync ===
    "function"
    ? (value as RouteSchema)
    : undefined;
}

/** The schema's object keys, for matching header names case-insensitively. */
function keysOf(schema: RouteSchema): readonly string[] {
  const shape = (schema as { shape?: unknown }).shape;
  return shape && typeof shape === "object" ? Object.keys(shape) : [];
}

function decoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function cookiesOf(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const pair of (header ?? "").split(";")) {
    const index = pair.indexOf("=");
    if (index < 0) continue;
    const name = pair.slice(0, index).trim();
    if (name) cookies[name] = decoded(pair.slice(index + 1).trim());
  }
  return cookies;
}

function validatorsOf(declaration: RouteDeclaration): Validator[] {
  const request = declaration.request ?? {};
  const validators: Validator[] = [];
  const valid = async (schema: RouteSchema, value: unknown) =>
    (await schema.safeParseAsync(value)).success;
  const query = schemaOf(request.query);
  if (query)
    validators.push((req) =>
      valid(
        query,
        Object.fromEntries(
          Object.entries(req.queries()).map(([name, values]) => [
            name,
            values.length === 1 ? values[0] : values,
          ]),
        ),
      ),
    );
  const params = schemaOf(request.params);
  if (params) validators.push((req) => valid(params, req.param()));
  const headers = schemaOf(request.headers);
  if (headers) {
    const names = new Map(keysOf(headers).map((key) => [key.toLowerCase(), key]));
    validators.push((req) =>
      valid(
        headers,
        Object.fromEntries(
          Object.entries(req.header()).map(([name, value]) => [
            names.get(name) ?? name,
            value,
          ]),
        ),
      ),
    );
  }
  const cookies = schemaOf(request.cookies);
  if (cookies)
    validators.push((req) => valid(cookies, cookiesOf(req.header("cookie"))));
  for (const [type, media] of Object.entries(request.body?.content ?? {})) {
    const schema = schemaOf(media?.schema);
    if (!schema || !JSON_TYPE.test(type)) continue;
    const required = request.body?.required === true;
    validators.push(async (req) => {
      const sent = req.header("content-type");
      const json = sent !== undefined && JSON_TYPE.test(sent);
      if (!json && !required) return true;
      // A required body that is not JSON is validated as an empty object.
      return valid(schema, json ? await req.json() : {});
    });
  }
  return validators;
}

/**
 * Compile a contribution; throws when its declaration names another
 * operation than the contribution does.
 * @param contribution - a registered contribution.
 */
export function compileRoute(contribution: RouteContribution): CompiledRoute {
  const declaration = contribution.declaration as RouteDeclaration;
  const template = (path: string) =>
    path.replace(/:([A-Za-z][A-Za-z0-9_]*)/gu, "{$1}");
  if (
    String(declaration.method).toLowerCase() !== contribution.method ||
    template(declaration.path) !== contribution.path
  )
    throw new Error(
      `HTTP contribution declares another route: ${contribution.id}`,
    );
  const segments = contribution.path.split("/");
  const method = contribution.method.toUpperCase();
  return {
    contribution,
    validators: validatorsOf(declaration),
    match(requestMethod, url) {
      if (requestMethod.toUpperCase() !== method) return undefined;
      const parts = url.pathname.split("/");
      if (parts.length !== segments.length) return undefined;
      const params: Record<string, string> = {};
      for (const [index, segment] of segments.entries()) {
        const part = parts[index]!;
        const name = /^\{([^}]+)\}$/u.exec(segment)?.[1];
        if (name === undefined) {
          if (part !== segment) return undefined;
        } else if (part === "") return undefined;
        else params[name] = decoded(part);
      }
      return params;
    },
  };
}

/** The request a handler reads; the body is read once and shared. */
function requestOf(raw: Request, params: Record<string, string>): RouteRequest {
  const url = new URL(raw.url);
  let bytes: Promise<ArrayBuffer> | undefined;
  const body = () => (bytes ??= raw.arrayBuffer());
  const text = () => body().then((buffer) => new TextDecoder().decode(buffer));
  let json: Promise<unknown> | undefined;
  const queries = (): Record<string, string[]> => {
    const all: Record<string, string[]> = {};
    for (const [name, value] of url.searchParams) (all[name] ??= []).push(value);
    return all;
  };
  const request = {
    raw,
    url: raw.url,
    method: raw.method,
    path: url.pathname,
    param: (name?: string) =>
      name === undefined ? { ...params } : (params[name] as string),
    query: (name?: string) =>
      name === undefined
        ? Object.fromEntries(
            Object.entries(queries()).map(([key, values]) => [key, values[0]]),
          )
        : (url.searchParams.get(name) ?? undefined),
    queries: (name?: string) =>
      name === undefined
        ? queries()
        : url.searchParams.has(name)
          ? url.searchParams.getAll(name)
          : undefined,
    header: (name?: string) => {
      if (name !== undefined) return raw.headers.get(name) ?? undefined;
      const all: Record<string, string> = {};
      raw.headers.forEach((value, key) => {
        all[key] = value;
      });
      return all;
    },
    json: () =>
      (json ??= text().then((value) => JSON.parse(value) as unknown)),
    text,
    arrayBuffer: () => body().then((buffer) => buffer.slice(0)),
  };
  return request as RouteRequest;
}

/** The context a handler builds its response with. */
function contextOf(req: RouteRequest): RouteContext {
  const prepared = new Headers();
  let status = 200;
  const respond = (
    data: BodyInit | null,
    init: RouteResponseInit | undefined,
    headers: RouteResponseHeaders | undefined,
  ): Response => {
    const responseHeaders = new Headers(prepared);
    if (typeof init === "object" && init.headers)
      for (const [key, value] of new Headers(init.headers))
        if (key === "set-cookie") responseHeaders.append(key, value);
        else responseHeaders.set(key, value);
    for (const [key, value] of Object.entries(headers ?? {}))
      if (typeof value === "string") responseHeaders.set(key, value);
      else {
        responseHeaders.delete(key);
        for (const each of value) responseHeaders.append(key, each);
      }
    return new Response(data, {
      status:
        typeof init === "number" ? init : (init?.status ?? status),
      headers: responseHeaders,
    });
  };
  return {
    req,
    header(name, value, options) {
      if (value === undefined) prepared.delete(name);
      else if (options?.append) prepared.append(name, value);
      else prepared.set(name, value);
    },
    status(next) {
      status = next;
    },
    json: (value, init, headers) =>
      respond(JSON.stringify(value), init, {
        "Content-Type": "application/json",
        ...headers,
      }),
    text: (text, init, headers) =>
      respond(text, init, {
        "Content-Type": "text/plain; charset=UTF-8",
        ...headers,
      }),
    body: respond,
    newResponse: respond,
  };
}

/** The 400 problem a failed validation answers; it discloses no input. */
function validationProblem(req: RouteRequest): Response {
  const supplied = req.header("X-Trace-Id");
  const traceId =
    supplied && UUID_PATTERN.test(supplied) ? supplied : randomUUID();
  return Response.json(
    {
      type: "https://dramaip.local/problems/validation_error",
      title: "Request validation failed",
      status: 400,
      detail: "Request validation failed",
      instance: req.path,
      code: "VALIDATION_ERROR",
      traceId,
    },
    { status: 400, headers: { "Content-Type": "application/problem+json" } },
  );
}

const internalError = (): Response =>
  new Response("Internal Server Error", {
    status: 500,
    headers: { "Content-Type": "text/plain; charset=UTF-8" },
  });

/**
 * Validate the request and run the route's handler.
 * @param route - the matched route.
 * @param raw - the request.
 * @param params - its decoded path parameters.
 * @returns the handler's response; a validation problem; 400 for a body
 *   that is not the JSON it says it is; 500 when the handler throws or
 *   answers no response.
 */
export async function runRoute(
  route: CompiledRoute,
  raw: Request,
  params: Record<string, string>,
): Promise<Response> {
  const req = requestOf(raw, params);
  try {
    for (const validate of route.validators) {
      let passed: boolean;
      try {
        passed = await validate(req);
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        return new Response("Malformed JSON in request body", { status: 400 });
      }
      if (!passed) return validationProblem(req);
    }
    const handler = route.contribution.handler as (
      context: RouteContext,
    ) => unknown;
    const response = await handler(contextOf(req));
    if (response instanceof Response) return response;
    throw new Error(`${route.contribution.id} answered no Response`);
  } catch (error) {
    console.error(error);
    return internalError();
  }
}
