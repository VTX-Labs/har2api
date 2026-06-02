/**
 * HAR 1.2 parsing.
 *
 * The HAR (HTTP Archive) format is what every browser's "Save all as HAR"
 * button produces. The full spec is large; we parse the subset that matters for
 * reconstructing an API — request method/URL/headers/query/body and the
 * response status/headers/body — and tolerate everything else being absent.
 *
 * Spec reference: http://www.softwareishard.com/blog/har-12-spec/
 *
 * The parser is defensive: a single malformed entry is skipped, not fatal, so a
 * real-world capture with the occasional odd record still yields a useful spec.
 */

/** A single HTTP header, query-string parameter, or cookie name/value pair. */
export interface HarNameValue {
  name: string;
  value: string;
}

/** Posted request body, if any. */
export interface HarPostData {
  mimeType: string;
  /** Raw body text (present for most JSON/form/text bodies). */
  text?: string;
  /** Parsed form fields, present for `application/x-www-form-urlencoded`. */
  params?: HarNameValue[];
}

/** The request half of a HAR entry. */
export interface HarRequest {
  method: string;
  url: string;
  headers: HarNameValue[];
  queryString: HarNameValue[];
  cookies: HarNameValue[];
  postData?: HarPostData;
}

/** Response content (body). */
export interface HarContent {
  mimeType: string;
  text?: string;
  /** `"base64"` when `text` is base64-encoded (e.g. binary responses). */
  encoding?: string;
}

/** The response half of a HAR entry. */
export interface HarResponse {
  status: number;
  statusText: string;
  headers: HarNameValue[];
  content: HarContent;
}

/** One request/response exchange. */
export interface HarEntry {
  request: HarRequest;
  response: HarResponse;
}

/** The parsed, validated archive: just the entries we care about. */
export interface HarLog {
  entries: HarEntry[];
}

/** Thrown when the input is not a recognizable HAR document. */
export class HarParseError extends Error {
  override readonly name = "HarParseError";
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function toNameValues(raw: unknown): HarNameValue[] {
  if (!Array.isArray(raw)) return [];
  const out: HarNameValue[] = [];
  for (const item of raw) {
    if (!isObject(item)) continue;
    const name = item["name"];
    if (typeof name !== "string") continue;
    const value = item["value"];
    out.push({ name, value: typeof value === "string" ? value : "" });
  }
  return out;
}

function parsePostData(raw: unknown): HarPostData | undefined {
  if (!isObject(raw)) return undefined;
  const mimeType = typeof raw["mimeType"] === "string" ? (raw["mimeType"] as string) : "";
  const post: HarPostData = { mimeType };
  if (typeof raw["text"] === "string") post.text = raw["text"] as string;
  const params = toNameValues(raw["params"]);
  if (params.length > 0) post.params = params;
  return post;
}

function parseRequest(raw: unknown): HarRequest | null {
  if (!isObject(raw)) return null;
  const method = raw["method"];
  const url = raw["url"];
  if (typeof method !== "string" || typeof url !== "string" || url === "") return null;
  const req: HarRequest = {
    method: method.toUpperCase(),
    url,
    headers: toNameValues(raw["headers"]),
    queryString: toNameValues(raw["queryString"]),
    cookies: toNameValues(raw["cookies"]),
  };
  const postData = parsePostData(raw["postData"]);
  if (postData) req.postData = postData;
  return req;
}

function parseContent(raw: unknown): HarContent {
  if (!isObject(raw)) return { mimeType: "" };
  const content: HarContent = {
    mimeType: typeof raw["mimeType"] === "string" ? (raw["mimeType"] as string) : "",
  };
  if (typeof raw["text"] === "string") content.text = raw["text"] as string;
  if (typeof raw["encoding"] === "string") content.encoding = raw["encoding"] as string;
  return content;
}

function parseResponse(raw: unknown): HarResponse | null {
  if (!isObject(raw)) return null;
  const status = raw["status"];
  if (typeof status !== "number") return null;
  return {
    status,
    statusText: typeof raw["statusText"] === "string" ? (raw["statusText"] as string) : "",
    headers: toNameValues(raw["headers"]),
    content: parseContent(raw["content"]),
  };
}

/**
 * Parse a HAR document (as a JSON string) into a validated {@link HarLog}.
 *
 * Throws {@link HarParseError} if the input is not valid JSON or has no
 * recognizable `log.entries` array. Individual malformed entries are skipped.
 */
export function parseHar(input: string): HarLog {
  let doc: unknown;
  try {
    doc = JSON.parse(stripBom(input));
  } catch (err) {
    throw new HarParseError(`Input is not valid JSON: ${(err as Error).message}`);
  }
  if (!isObject(doc)) throw new HarParseError("HAR root must be an object.");

  const log = doc["log"];
  if (!isObject(log)) {
    throw new HarParseError('HAR document is missing the "log" object.');
  }
  const rawEntries = log["entries"];
  if (!Array.isArray(rawEntries)) {
    throw new HarParseError('HAR "log.entries" must be an array.');
  }

  const entries: HarEntry[] = [];
  for (const raw of rawEntries) {
    if (!isObject(raw)) continue;
    const request = parseRequest(raw["request"]);
    const response = parseResponse(raw["response"]);
    if (request === null || response === null) continue;
    entries.push({ request, response });
  }

  if (entries.length === 0) {
    throw new HarParseError(
      "No usable request/response entries found in the HAR file.",
    );
  }
  return { entries };
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}
