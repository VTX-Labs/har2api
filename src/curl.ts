/**
 * cURL command generation.
 *
 * Emits one ready-to-run `curl` command per inferred operation — handy for
 * docs, bug reports, or pasting into a terminal. Path params and any sensitive
 * query values are rendered as obvious placeholders; auth is shown as a
 * commented-out header so the command is safe to share as-is.
 */

import type { ApiModel, AuthScheme, OperationModel } from "./infer.js";

/** Single-quote a string for POSIX shells, escaping embedded quotes. */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Fill `{id}` path templates with `:id`-style placeholders for the URL. */
function concretePath(path: string): string {
  return path.replace(/\{([^}]+)\}/g, (_m, name: string) => `:${name}`);
}

function authHeaderHint(auth: AuthScheme): string | null {
  switch (auth.type) {
    case "http":
      return auth.scheme === "bearer"
        ? `-H 'Authorization: Bearer $TOKEN'`
        : `-u "$USERNAME:$PASSWORD"`;
    case "apiKey":
      return auth.in === "header" ? `-H '${auth.name}: $API_KEY'` : null;
    case "none":
      return null;
  }
}

function buildQuery(op: OperationModel, auth: AuthScheme): string {
  const pairs: string[] = [];
  for (const q of op.query) {
    const value = q.sensitive ? "$SECRET" : (q.example ?? "VALUE");
    pairs.push(`${encodeURIComponent(q.name)}=${q.sensitive ? value : encodeURIComponent(value)}`);
  }
  // API key carried in the query string.
  if (auth.type === "apiKey" && auth.in === "query" && !op.query.some((q) => q.name === auth.name)) {
    pairs.push(`${encodeURIComponent(auth.name)}=$API_KEY`);
  }
  return pairs.length > 0 ? `?${pairs.join("&")}` : "";
}

/** Build a single cURL command string for one operation. */
export function toCurlCommand(op: OperationModel, server: string | undefined, auth: AuthScheme): string {
  const base = server ?? "";
  const url = `${base}${concretePath(op.path)}${buildQuery(op, auth)}`;

  const parts = [`curl -X ${op.method}`, shellQuote(url)];

  const authHint = authHeaderHint(auth);
  if (authHint) parts.push(authHint);

  if (op.requestSamples.length > 0) {
    const ct = op.requestContentType ?? "application/json";
    parts.push(`-H 'Content-Type: ${ct}'`);
    const body = JSON.stringify(op.requestSamples[0] ?? {});
    parts.push(`-d ${shellQuote(body)}`);
  }

  // Render as a single line; long commands stay copy-pasteable.
  return parts.join(" ");
}

/** Build cURL commands for every operation in the model. */
export function toCurl(model: ApiModel): string {
  const server = model.servers[0];
  const lines: string[] = [];
  for (const op of model.operations) {
    lines.push(`# ${op.method} ${op.path}`);
    lines.push(toCurlCommand(op, server, model.auth));
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}
