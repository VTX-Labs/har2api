import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { toCurl, toCurlCommand } from "../src/curl.js";
import { parseHar } from "../src/har.js";
import { inferApi } from "../src/infer.js";

const fixture = readFileSync(fileURLToPath(new URL("./fixtures/sample.har", import.meta.url)), "utf8");
const model = inferApi(parseHar(fixture));

describe("toCurl", () => {
  const out = toCurl(model);

  it("emits a labeled command per operation", () => {
    expect(out).toContain("# GET /v1/users");
    expect(out).toContain("# POST /v1/users");
    expect(out).toContain("# GET /v1/users/{userId}");
  });

  it("uses the bearer token as an environment variable, never a captured value", () => {
    expect(out).toContain("Authorization: Bearer $TOKEN");
    expect(out).not.toContain("abc.def.ghi");
  });

  it("renders path params as :placeholders", () => {
    expect(out).toContain("/v1/users/:userId");
  });

  it("renders a sensitive query value as a placeholder, not the secret", () => {
    expect(out).toContain("api_key=$SECRET");
    expect(out).not.toContain("SECRET123");
  });
});

describe("toCurlCommand", () => {
  it("includes a JSON body for write operations with secrets redacted", () => {
    const post = model.operations.find((o) => o.method === "POST")!;
    const cmd = toCurlCommand(post, model.servers[0], model.auth);
    expect(cmd).toContain("-X POST");
    expect(cmd).toContain("Content-Type: application/json");
    expect(cmd).toContain("<redacted>");
    expect(cmd).not.toContain("hunter2");
  });

  it("single-quotes the URL safely", () => {
    const get = model.operations.find((o) => o.method === "GET" && o.path === "/v1/users")!;
    const cmd = toCurlCommand(get, model.servers[0], model.auth);
    expect(cmd).toMatch(/curl -X GET '/);
  });

  it("puts an apiKey query auth onto the URL when not already present", () => {
    const cmd = toCurlCommand(
      { method: "GET", path: "/x", count: 1, query: [], requestSamples: [], responses: [] },
      "https://k.test",
      { type: "apiKey", in: "query", name: "access_token" },
    );
    expect(cmd).toContain("access_token=$API_KEY");
  });
});
