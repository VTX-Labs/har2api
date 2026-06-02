/**
 * Endpoint inference.
 *
 * Raw HAR entries are individual HTTP calls. This turns them into an *API
 * model*: requests to the same logical endpoint are grouped, dynamic path
 * segments (ids, uuids, slugs) are collapsed into `{param}` templates, and per
 * endpoint we collect the methods used, query parameters, request/response
 * content types, sample bodies, and the detected authentication scheme.
 */

import type { HarEntry, HarLog, HarNameValue } from "./har.js";
import { isSensitiveParam, redactJson } from "./redact.js";

/** A detected authentication mechanism for the whole API. */
export type AuthScheme =
  | { type: "http"; scheme: "bearer" | "basic" }
  | { type: "apiKey"; in: "header" | "query"; name: string }
  | { type: "none" };

/** A single observed query-string parameter. */
export interface ParamModel {
  name: string;
  /** Whether it appeared on every request to the operation. */
  required: boolean;
  /** Whether its value is treated as a secret (masked in output). */
  sensitive: boolean;
  example?: string;
}

/** One method on one path template (e.g. `GET /users/{id}`). */
export interface OperationModel {
  method: string;
  /** Templated path, e.g. `/users/{id}`. */
  path: string;
  /** How many HAR entries were folded into this operation. */
  count: number;
  query: ParamModel[];
  /** Request `Content-Type`, if a body was sent. */
  requestContentType?: string;
  /** Parsed request body samples (JSON) for schema inference. */
  requestSamples: unknown[];
  /** Response status → content type + parsed body samples. */
  responses: ResponseModel[];
}

/** One observed response status for an operation. */
export interface ResponseModel {
  status: number;
  contentType?: string;
  samples: unknown[];
}

/** The full inferred API. */
export interface ApiModel {
  /** Inferred base server URL (scheme + host), if all entries agree. */
  servers: string[];
  auth: AuthScheme;
  operations: OperationModel[];
}

/** Options controlling inference. */
export interface InferOptions {
  /**
   * Only include requests whose host matches one of these (case-insensitive).
   * Useful to drop analytics/CDN noise. Empty means "all hosts".
   */
  includeHosts?: string[];
  /**
   * Drop requests for static assets (images, fonts, css, js, …). Default true —
   * a HAR of a web app is mostly assets, and they're rarely the API.
   */
  dropAssets?: boolean;
}

const ASSET_EXT =
  /\.(png|jpe?g|gif|webp|svg|ico|bmp|css|js|mjs|map|woff2?|ttf|eot|otf|mp4|webm|mp3|wav|pdf|wasm)$/i;

/** Segments that look dynamic and should become `{param}` templates. */
function isDynamicSegment(seg: string): boolean {
  if (seg === "") return false;
  // Pure integer ids.
  if (/^\d+$/.test(seg)) return true;
  // UUIDs.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return true;
  // Long hex / base-ish tokens (object ids, hashes).
  if (/^[0-9a-f]{16,}$/i.test(seg)) return true;
  if (seg.length >= 20 && /^[A-Za-z0-9_-]+$/.test(seg) && /\d/.test(seg)) return true;
  return false;
}

/** Name a path parameter from the preceding collection segment (`/users/{id}`). */
function paramNameFor(prevSegment: string | undefined, used: Set<string>): string {
  let base = "id";
  if (prevSegment && /^[A-Za-z][A-Za-z0-9_-]*$/.test(prevSegment)) {
    // singularize a trailing "s" → /users → userId
    const singular = prevSegment.endsWith("s") ? prevSegment.slice(0, -1) : prevSegment;
    base = `${singular}Id`;
  }
  let name = base;
  let n = 2;
  while (used.has(name)) name = `${base}${n++}`;
  used.add(name);
  return name;
}

/** Templatize a concrete path into a pattern + the param names introduced. */
function templatizePath(pathname: string): string {
  const segs = pathname.split("/");
  const used = new Set<string>();
  const out = segs.map((seg, i) => {
    if (isDynamicSegment(seg)) {
      const name = paramNameFor(segs[i - 1], used);
      return `{${name}}`;
    }
    return seg;
  });
  const joined = out.join("/");
  return joined === "" ? "/" : joined;
}

function headerValue(headers: HarNameValue[], name: string): string | undefined {
  const lower = name.toLowerCase();
  return headers.find((h) => h.name.toLowerCase() === lower)?.value;
}

/** Content type without parameters (`application/json; charset=utf-8` → `application/json`). */
function baseContentType(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const semi = value.indexOf(";");
  return (semi === -1 ? value : value.slice(0, semi)).trim().toLowerCase();
}

function tryParseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function detectAuth(entries: HarEntry[]): AuthScheme {
  for (const { request } of entries) {
    const auth = headerValue(request.headers, "authorization");
    if (auth) {
      const scheme = auth.split(/\s+/, 1)[0]?.toLowerCase();
      if (scheme === "bearer") return { type: "http", scheme: "bearer" };
      if (scheme === "basic") return { type: "http", scheme: "basic" };
    }
  }
  // API key in a header.
  for (const { request } of entries) {
    for (const h of request.headers) {
      const n = h.name.toLowerCase();
      if (n === "x-api-key" || n === "api-key" || n === "apikey" || n === "x-auth-token") {
        return { type: "apiKey", in: "header", name: h.name };
      }
    }
  }
  // API key in the query string.
  for (const { request } of entries) {
    for (const q of request.queryString) {
      const n = q.name.toLowerCase();
      if (n === "api_key" || n === "apikey" || n === "access_token" || n === "token") {
        return { type: "apiKey", in: "query", name: q.name };
      }
    }
  }
  return { type: "none" };
}

interface OpKey {
  method: string;
  path: string;
}

function keyOf(k: OpKey): string {
  return `${k.method} ${k.path}`;
}

/** Reduce a list of HAR entries to a structured {@link ApiModel}. */
export function inferApi(log: HarLog, options: InferOptions = {}): ApiModel {
  const dropAssets = options.dropAssets ?? true;
  const includeHosts = (options.includeHosts ?? []).map((h) => h.toLowerCase());

  const kept: Array<{ entry: HarEntry; url: URL }> = [];
  for (const entry of log.entries) {
    let url: URL;
    try {
      url = new URL(entry.request.url);
    } catch {
      continue; // non-absolute URLs can't be placed on a server; skip.
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    if (includeHosts.length > 0 && !includeHosts.includes(url.hostname.toLowerCase())) continue;
    if (dropAssets && ASSET_EXT.test(url.pathname)) continue;
    kept.push({ entry, url });
  }

  const servers = [...new Set(kept.map(({ url }) => `${url.protocol}//${url.host}`))].sort();
  const auth = detectAuth(kept.map((k) => k.entry));

  // Group by (method, templated path).
  const groups = new Map<string, { key: OpKey; items: typeof kept }>();
  for (const item of kept) {
    const key: OpKey = {
      method: item.entry.request.method,
      path: templatizePath(item.url.pathname),
    };
    const id = keyOf(key);
    let g = groups.get(id);
    if (!g) {
      g = { key, items: [] };
      groups.set(id, g);
    }
    g.items.push(item);
  }

  const operations: OperationModel[] = [];
  for (const { key, items } of groups.values()) {
    operations.push(buildOperation(key, items));
  }
  operations.sort((a, b) => (a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path)));

  return { servers, auth, operations };
}

function buildOperation(key: OpKey, items: Array<{ entry: HarEntry; url: URL }>): OperationModel {
  const count = items.length;

  // Query parameters: union across all requests, required if on every request.
  const querySeen = new Map<string, { count: number; example?: string; sensitive: boolean }>();
  for (const { url } of items) {
    const names = new Set<string>();
    for (const [name, value] of url.searchParams) {
      names.add(name);
      const prev = querySeen.get(name);
      if (prev) {
        if (prev.example === undefined && value !== "") prev.example = value;
      } else {
        querySeen.set(name, {
          count: 0,
          sensitive: isSensitiveParam(name),
          ...(value !== "" ? { example: value } : {}),
        });
      }
    }
    for (const name of names) querySeen.get(name)!.count++;
  }
  const query: ParamModel[] = [...querySeen.entries()]
    .map(([name, info]) => ({
      name,
      required: info.count === count,
      sensitive: info.sensitive,
      ...(info.example !== undefined && !info.sensitive ? { example: info.example } : {}),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Request body samples.
  let requestContentType: string | undefined;
  const requestSamples: unknown[] = [];
  for (const { entry } of items) {
    const post = entry.request.postData;
    if (!post?.text) continue;
    const ct = baseContentType(post.mimeType) ?? baseContentType(headerValue(entry.request.headers, "content-type"));
    if (ct) requestContentType = ct;
    if (ct === "application/json" || ct === undefined) {
      const parsed = tryParseJson(post.text);
      if (parsed !== undefined) requestSamples.push(redactJson(parsed));
    }
  }

  // Responses grouped by status.
  const respByStatus = new Map<number, { contentType?: string; samples: unknown[] }>();
  for (const { entry } of items) {
    const { response } = entry;
    let r = respByStatus.get(response.status);
    if (!r) {
      r = { samples: [] };
      respByStatus.set(response.status, r);
    }
    const ct = baseContentType(response.content.mimeType) ?? baseContentType(headerValue(response.headers, "content-type"));
    if (ct) r.contentType = ct;
    const body = response.content.text;
    if (body && response.content.encoding !== "base64" && ct === "application/json") {
      const parsed = tryParseJson(body);
      if (parsed !== undefined) r.samples.push(redactJson(parsed));
    }
  }
  const responses: ResponseModel[] = [...respByStatus.entries()]
    .map(([status, r]) => ({
      status,
      ...(r.contentType ? { contentType: r.contentType } : {}),
      samples: r.samples,
    }))
    .sort((a, b) => a.status - b.status);

  return {
    method: key.method,
    path: key.path,
    count,
    query,
    ...(requestContentType ? { requestContentType } : {}),
    requestSamples,
    responses,
  };
}
