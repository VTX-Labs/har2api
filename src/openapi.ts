/**
 * OpenAPI 3.1 document generation.
 *
 * Turns the inferred {@link ApiModel} into a valid OpenAPI 3.1 document. 3.1 is
 * a superset of JSON Schema 2020-12, so the schemas produced by
 * {@link inferSchema} drop straight into request/response bodies.
 */

import type { ApiModel, AuthScheme, OperationModel } from "./infer.js";
import { inferSchema, type JsonSchema } from "./schema.js";

/** Tunable metadata for the generated document. */
export interface OpenApiOptions {
  title?: string;
  version?: string;
  description?: string;
}

interface OpenApiDoc {
  openapi: "3.1.0";
  info: { title: string; version: string; description?: string };
  servers?: Array<{ url: string }>;
  paths: Record<string, Record<string, unknown>>;
  components?: { securitySchemes?: Record<string, unknown> };
  security?: Array<Record<string, never[]>>;
}

const HTTP_REASON: Record<number, string> = {
  200: "OK",
  201: "Created",
  202: "Accepted",
  204: "No Content",
  301: "Moved Permanently",
  302: "Found",
  304: "Not Modified",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
};

function reason(status: number): string {
  return HTTP_REASON[status] ?? `Status ${status}`;
}

function securitySchemeFor(auth: AuthScheme): { name: string; scheme: Record<string, unknown> } | null {
  switch (auth.type) {
    case "http":
      return {
        name: auth.scheme === "bearer" ? "bearerAuth" : "basicAuth",
        scheme:
          auth.scheme === "bearer"
            ? { type: "http", scheme: "bearer" }
            : { type: "http", scheme: "basic" },
      };
    case "apiKey":
      return {
        name: "apiKeyAuth",
        scheme: { type: "apiKey", in: auth.in, name: auth.name },
      };
    case "none":
      return null;
  }
}

/** Path-template params (`{id}`) in declaration order. */
function pathParams(path: string): string[] {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1] as string);
}

function buildParameters(op: OperationModel): unknown[] {
  const params: unknown[] = [];
  for (const name of pathParams(op.path)) {
    params.push({
      name,
      in: "path",
      required: true,
      schema: { type: "string" },
    });
  }
  for (const q of op.query) {
    const schema: JsonSchema = { type: "string" };
    if (q.example !== undefined) schema.example = q.example;
    params.push({
      name: q.name,
      in: "query",
      required: q.required,
      schema,
    });
  }
  return params;
}

function buildRequestBody(op: OperationModel): Record<string, unknown> | undefined {
  if (op.requestSamples.length === 0) return undefined;
  const ct = op.requestContentType ?? "application/json";
  return {
    required: true,
    content: {
      [ct]: { schema: inferSchema(op.requestSamples) },
    },
  };
}

function buildResponses(op: OperationModel): Record<string, unknown> {
  const responses: Record<string, unknown> = {};
  for (const r of op.responses) {
    const response: Record<string, unknown> = { description: reason(r.status) };
    if (r.contentType && r.samples.length > 0) {
      response["content"] = {
        [r.contentType]: { schema: inferSchema(r.samples) },
      };
    }
    responses[String(r.status)] = response;
  }
  if (Object.keys(responses).length === 0) responses["default"] = { description: "Response" };
  return responses;
}

function operationId(op: OperationModel): string {
  const parts = op.path
    .split("/")
    .filter(Boolean)
    .map((seg) => (seg.startsWith("{") ? "By" + capitalize(seg.slice(1, -1)) : capitalize(seg)));
  return op.method.toLowerCase() + parts.join("");
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

/** Build an OpenAPI 3.1 document from an inferred API model. */
export function toOpenApi(model: ApiModel, options: OpenApiOptions = {}): OpenApiDoc {
  const host = model.servers[0] ? new URL(model.servers[0]).host : "the captured API";
  const info: OpenApiDoc["info"] = {
    title: options.title ?? `${host} API`,
    version: options.version ?? "1.0.0",
  };
  if (options.description !== undefined) info.description = options.description;

  const doc: OpenApiDoc = {
    openapi: "3.1.0",
    info,
    paths: {},
  };
  if (model.servers.length > 0) doc.servers = model.servers.map((url) => ({ url }));

  const sec = securitySchemeFor(model.auth);
  if (sec) {
    doc.components = { securitySchemes: { [sec.name]: sec.scheme } };
    doc.security = [{ [sec.name]: [] }];
  }

  for (const op of model.operations) {
    const path = doc.paths[op.path] ?? (doc.paths[op.path] = {});
    const operation: Record<string, unknown> = {
      operationId: operationId(op),
      summary: `${op.method} ${op.path}`,
      responses: buildResponses(op),
    };
    const params = buildParameters(op);
    if (params.length > 0) operation["parameters"] = params;
    const body = buildRequestBody(op);
    if (body) operation["requestBody"] = body;
    path[op.method.toLowerCase()] = operation;
  }

  return doc;
}
