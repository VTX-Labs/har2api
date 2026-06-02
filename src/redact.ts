/**
 * Redaction of secrets captured in a HAR file.
 *
 * A real HAR almost always contains live credentials — `Authorization`
 * bearer tokens, API keys, session cookies, CSRF tokens. The generated spec
 * documents that these headers *exist* and what shape they take, but it must
 * never leak the actual secret value. By default we redact aggressively and
 * fail closed: a header we are unsure about is treated as sensitive.
 */

/** Header names whose values are always secrets and must be masked. */
const SENSITIVE_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "x-access-token",
  "x-csrf-token",
  "x-xsrf-token",
  "api-key",
  "apikey",
]);

/** Substrings in a header name that mark it sensitive (covers `x-*-token` etc.). */
const SENSITIVE_HINTS = ["token", "secret", "password", "passwd", "auth", "session", "credential"];

/** Query-string / form keys whose values are commonly secrets. */
const SENSITIVE_PARAM_HINTS = [
  "token",
  "secret",
  "password",
  "passwd",
  "apikey",
  "api_key",
  "access_token",
  "refresh_token",
  "client_secret",
  "signature",
  "sig",
];

/** The placeholder substituted for any redacted value. */
export const REDACTED = "<redacted>";

/** True if a header name should have its value masked. */
export function isSensitiveHeader(name: string): boolean {
  const lower = name.toLowerCase();
  if (SENSITIVE_HEADERS.has(lower)) return true;
  return SENSITIVE_HINTS.some((h) => lower.includes(h));
}

/** True if a query-string or form-field key should have its value masked. */
export function isSensitiveParam(name: string): boolean {
  const lower = name.toLowerCase();
  return SENSITIVE_PARAM_HINTS.some((h) => lower.includes(h));
}

/** True if an object key in a JSON body holds a value we should never echo. */
export function isSensitiveKey(name: string): boolean {
  const lower = name.toLowerCase();
  return SENSITIVE_PARAM_HINTS.some((h) => lower.includes(h)) || SENSITIVE_HINTS.some((h) => lower.includes(h));
}

/**
 * Recursively replace the values of secret-looking keys in a parsed JSON body
 * with {@link REDACTED}, leaving structure and non-secret values intact. The
 * schema we infer from the result still records that the field is a string —
 * it just won't carry the real token into an `example`.
 */
export function redactJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => redactJson(v));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveKey(k) && typeof v === "string" ? REDACTED : redactJson(v);
    }
    return out;
  }
  return value;
}

/**
 * Mask a header value for output. For `Authorization` we keep the scheme
 * (`Bearer`, `Basic`, …) so the spec still documents the auth mechanism, but
 * replace the credential itself.
 */
export function redactHeaderValue(name: string, value: string): string {
  if (name.toLowerCase() === "authorization") {
    const scheme = value.split(/\s+/, 1)[0] ?? "";
    if (scheme && /^[A-Za-z]+$/.test(scheme) && scheme.length < value.length) {
      return `${scheme} ${REDACTED}`;
    }
  }
  return REDACTED;
}
