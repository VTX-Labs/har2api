/**
 * Postman Collection v2.1 generation.
 *
 * Emits a collection importable straight into Postman / Insomnia / Bruno. Each
 * inferred operation becomes a request; templated path params (`{id}`) become
 * Postman path variables (`:id`); the detected auth scheme becomes the
 * collection-level auth. Secret values are never written — auth is configured
 * with empty placeholders for the user to fill in.
 */

import type { ApiModel, AuthScheme, OperationModel } from "./infer.js";
import { inferSchema } from "./schema.js";

interface PostmanCollection {
  info: { name: string; schema: string; description?: string };
  item: unknown[];
  auth?: Record<string, unknown>;
  variable?: Array<{ key: string; value: string }>;
}

/** Convert OpenAPI-style `{id}` templates to Postman `:id` and split segments. */
function toPostmanPath(path: string): { segments: string[]; vars: string[] } {
  const segments: string[] = [];
  const vars: string[] = [];
  for (const seg of path.split("/").filter(Boolean)) {
    if (seg.startsWith("{") && seg.endsWith("}")) {
      const name = seg.slice(1, -1);
      vars.push(name);
      segments.push(`:${name}`);
    } else {
      segments.push(seg);
    }
  }
  return { segments, vars };
}

function postmanAuth(auth: AuthScheme): Record<string, unknown> | undefined {
  switch (auth.type) {
    case "http":
      return auth.scheme === "bearer"
        ? { type: "bearer", bearer: [{ key: "token", value: "{{token}}", type: "string" }] }
        : {
            type: "basic",
            basic: [
              { key: "username", value: "{{username}}", type: "string" },
              { key: "password", value: "{{password}}", type: "string" },
            ],
          };
    case "apiKey":
      return {
        type: "apikey",
        apikey: [
          { key: "key", value: auth.name, type: "string" },
          { key: "value", value: "{{apiKey}}", type: "string" },
          { key: "in", value: auth.in, type: "string" },
        ],
      };
    case "none":
      return undefined;
  }
}

function buildItem(op: OperationModel, server: string | undefined): unknown {
  const { segments, vars } = toPostmanPath(op.path);
  const host = server ? new URL(server) : undefined;

  const url: Record<string, unknown> = {
    raw: `${server ?? ""}${op.path}`,
    path: segments,
  };
  if (host) {
    url["protocol"] = host.protocol.replace(":", "");
    url["host"] = host.hostname.split(".");
    if (host.port) url["port"] = host.port;
  }
  if (op.query.length > 0) {
    url["query"] = op.query.map((q) => ({
      key: q.name,
      value: q.sensitive ? "" : (q.example ?? ""),
      disabled: !q.required,
    }));
  }
  if (vars.length > 0) {
    url["variable"] = vars.map((v) => ({ key: v, value: "" }));
  }

  const request: Record<string, unknown> = {
    method: op.method,
    header: [] as unknown[],
    url,
  };

  if (op.requestSamples.length > 0) {
    const schema = inferSchema(op.requestSamples);
    request["header"] = [{ key: "Content-Type", value: op.requestContentType ?? "application/json" }];
    request["body"] = {
      mode: "raw",
      raw: JSON.stringify(op.requestSamples[0] ?? schema.example ?? {}, null, 2),
      options: { raw: { language: "json" } },
    };
  }

  return {
    name: `${op.method} ${op.path}`,
    request,
    response: [],
  };
}

/** Build a Postman Collection v2.1 from an inferred API model. */
export function toPostman(model: ApiModel, name?: string): PostmanCollection {
  const server = model.servers[0];
  const host = server ? new URL(server).host : "Captured API";
  const collection: PostmanCollection = {
    info: {
      name: name ?? `${host} (har2api)`,
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    item: model.operations.map((op) => buildItem(op, server)),
  };
  const auth = postmanAuth(model.auth);
  if (auth) collection.auth = auth;
  if (server) collection.variable = [{ key: "baseUrl", value: server }];
  return collection;
}
