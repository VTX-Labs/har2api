import { describe, expect, it } from "vitest";
import { HarParseError, parseHar } from "../src/har.js";

describe("parseHar", () => {
  it("parses a minimal valid HAR", () => {
    const har = JSON.stringify({
      log: {
        entries: [
          {
            request: { method: "get", url: "https://x.test/a", headers: [], queryString: [], cookies: [] },
            response: { status: 200, statusText: "OK", headers: [], content: { mimeType: "application/json" } },
          },
        ],
      },
    });
    const log = parseHar(har);
    expect(log.entries).toHaveLength(1);
    expect(log.entries[0]!.request.method).toBe("GET"); // upper-cased
  });

  it("throws on invalid JSON", () => {
    expect(() => parseHar("{not json")).toThrow(HarParseError);
  });

  it("throws when log is missing", () => {
    expect(() => parseHar(JSON.stringify({ foo: 1 }))).toThrow(/missing the "log"/);
  });

  it("throws when entries is not an array", () => {
    expect(() => parseHar(JSON.stringify({ log: { entries: {} } }))).toThrow(/must be an array/);
  });

  it("throws when there are no usable entries", () => {
    expect(() => parseHar(JSON.stringify({ log: { entries: [] } }))).toThrow(/No usable/);
  });

  it("skips malformed entries but keeps valid ones", () => {
    const har = JSON.stringify({
      log: {
        entries: [
          { request: { method: "GET" }, response: { status: 200 } }, // missing url -> skipped
          { notARequest: true },
          {
            request: { method: "GET", url: "https://x.test/ok", headers: [], queryString: [], cookies: [] },
            response: { status: 200, statusText: "", headers: [], content: { mimeType: "" } },
          },
        ],
      },
    });
    const log = parseHar(har);
    expect(log.entries).toHaveLength(1);
    expect(log.entries[0]!.request.url).toBe("https://x.test/ok");
  });

  it("tolerates a leading UTF-8 BOM", () => {
    const inner = {
      log: {
        entries: [
          {
            request: { method: "GET", url: "https://x.test/a", headers: [], queryString: [], cookies: [] },
            response: { status: 200, statusText: "OK", headers: [], content: { mimeType: "" } },
          },
        ],
      },
    };
    const log = parseHar("﻿" + JSON.stringify(inner));
    expect(log.entries).toHaveLength(1);
  });

  it("parses postData params and response encoding", () => {
    const har = JSON.stringify({
      log: {
        entries: [
          {
            request: {
              method: "POST",
              url: "https://x.test/a",
              headers: [],
              queryString: [],
              cookies: [],
              postData: { mimeType: "application/x-www-form-urlencoded", params: [{ name: "a", value: "1" }] },
            },
            response: {
              status: 200,
              statusText: "OK",
              headers: [],
              content: { mimeType: "image/png", text: "AAAA", encoding: "base64" },
            },
          },
        ],
      },
    });
    const log = parseHar(har);
    expect(log.entries[0]!.request.postData?.params).toEqual([{ name: "a", value: "1" }]);
    expect(log.entries[0]!.response.content.encoding).toBe("base64");
  });
});
