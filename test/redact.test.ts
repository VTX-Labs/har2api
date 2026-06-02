import { describe, expect, it } from "vitest";
import {
  isSensitiveHeader,
  isSensitiveKey,
  isSensitiveParam,
  REDACTED,
  redactHeaderValue,
  redactJson,
} from "../src/redact.js";

describe("isSensitiveHeader", () => {
  it("flags well-known auth headers", () => {
    expect(isSensitiveHeader("Authorization")).toBe(true);
    expect(isSensitiveHeader("Cookie")).toBe(true);
    expect(isSensitiveHeader("X-Api-Key")).toBe(true);
  });
  it("flags headers by hint substring", () => {
    expect(isSensitiveHeader("X-Session-Token")).toBe(true);
    expect(isSensitiveHeader("My-Secret-Thing")).toBe(true);
  });
  it("leaves ordinary headers alone", () => {
    expect(isSensitiveHeader("Accept")).toBe(false);
    expect(isSensitiveHeader("Content-Type")).toBe(false);
  });
});

describe("isSensitiveParam / isSensitiveKey", () => {
  it("flags secret-looking params", () => {
    expect(isSensitiveParam("api_key")).toBe(true);
    expect(isSensitiveParam("access_token")).toBe(true);
    expect(isSensitiveParam("page")).toBe(false);
  });
  it("flags secret-looking body keys", () => {
    expect(isSensitiveKey("password")).toBe(true);
    expect(isSensitiveKey("refreshToken")).toBe(true);
    expect(isSensitiveKey("email")).toBe(false);
  });
});

describe("redactHeaderValue", () => {
  it("keeps the Authorization scheme but masks the credential", () => {
    expect(redactHeaderValue("Authorization", "Bearer abc.def")).toBe(`Bearer ${REDACTED}`);
    expect(redactHeaderValue("Authorization", "Basic dXNlcjpwYXNz")).toBe(`Basic ${REDACTED}`);
  });
  it("fully masks other sensitive headers", () => {
    expect(redactHeaderValue("X-Api-Key", "k-123")).toBe(REDACTED);
  });
});

describe("redactJson", () => {
  it("masks string values of sensitive keys, recursively", () => {
    const out = redactJson({
      email: "a@b.com",
      password: "hunter2",
      nested: { access_token: "xyz", id: 7 },
      list: [{ secret: "s" }, { ok: 1 }],
    });
    expect(out).toEqual({
      email: "a@b.com",
      password: REDACTED,
      nested: { access_token: REDACTED, id: 7 },
      list: [{ secret: REDACTED }, { ok: 1 }],
    });
  });

  it("leaves non-string secret values structurally intact", () => {
    // A numeric "token" is unusual; we only mask strings, but keep the key.
    const out = redactJson({ token: 12345 }) as Record<string, unknown>;
    expect(out["token"]).toBe(12345);
  });

  it("passes through primitives untouched", () => {
    expect(redactJson("hello")).toBe("hello");
    expect(redactJson(42)).toBe(42);
    expect(redactJson(null)).toBe(null);
  });
});
