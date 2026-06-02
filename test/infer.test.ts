import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseHar } from "../src/har.js";
import { inferApi, type OperationModel } from "../src/infer.js";
import { REDACTED } from "../src/redact.js";

const fixture = readFileSync(fileURLToPath(new URL("./fixtures/sample.har", import.meta.url)), "utf8");
const log = parseHar(fixture);

function op(ops: OperationModel[], method: string, path: string): OperationModel {
  const found = ops.find((o) => o.method === method && o.path === path);
  if (!found) throw new Error(`operation ${method} ${path} not found in ${ops.map((o) => `${o.method} ${o.path}`).join(", ")}`);
  return found;
}

describe("inferApi", () => {
  const model = inferApi(log);

  it("infers a single server from a consistent host", () => {
    expect(model.servers).toEqual(["https://api.example.com"]);
  });

  it("detects bearer auth", () => {
    expect(model.auth).toEqual({ type: "http", scheme: "bearer" });
  });

  it("drops static assets by default", () => {
    expect(model.operations.some((o) => o.path.includes("logo"))).toBe(false);
    // cdn.example.com was the only other host and only served the asset.
    expect(model.servers).not.toContain("https://cdn.example.com");
  });

  it("templatizes numeric and uuid path segments and names the param", () => {
    const paths = model.operations.map((o) => o.path);
    expect(paths).toContain("/v1/users/{userId}");
    // The numeric id and the uuid id collapse into the same templated operation.
    const getById = op(model.operations, "GET", "/v1/users/{userId}");
    expect(getById.count).toBe(2);
  });

  it("groups list requests and marks query params required only when ubiquitous", () => {
    const list = op(model.operations, "GET", "/v1/users");
    expect(list.count).toBe(2);
    const page = list.query.find((q) => q.name === "page");
    const apiKey = list.query.find((q) => q.name === "api_key");
    expect(page?.required).toBe(true); // on both list requests
    expect(apiKey?.required).toBe(false); // only the first request had it
  });

  it("marks api_key query param sensitive and omits its example", () => {
    const list = op(model.operations, "GET", "/v1/users");
    const apiKey = list.query.find((q) => q.name === "api_key");
    expect(apiKey?.sensitive).toBe(true);
    expect(apiKey?.example).toBeUndefined();
  });

  it("captures request body samples with secrets redacted", () => {
    const create = op(model.operations, "POST", "/v1/users");
    expect(create.requestSamples).toHaveLength(1);
    const body = create.requestSamples[0] as Record<string, unknown>;
    expect(body["email"]).toBe("new@u.com");
    expect(body["password"]).toBe(REDACTED);
  });

  it("groups responses by status and redacts secret fields in bodies", () => {
    const getById = op(model.operations, "GET", "/v1/users/{userId}");
    const statuses = getById.responses.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 404]);
    const ok = getById.responses.find((r) => r.status === 200)!;
    const sample = ok.samples[0] as Record<string, unknown>;
    expect(sample["token"]).toBe(REDACTED);
    expect(sample["email"]).toBe("x@y.com");
  });

  it("honors includeHosts filtering", () => {
    const onlyCdn = inferApi(log, { includeHosts: ["cdn.example.com"], dropAssets: false });
    expect(onlyCdn.servers).toEqual(["https://cdn.example.com"]);
    expect(onlyCdn.operations).toHaveLength(1);
  });

  it("can keep assets when asked", () => {
    const withAssets = inferApi(log, { dropAssets: false });
    expect(withAssets.operations.some((o) => o.path.includes("logo"))).toBe(true);
  });

  it("detects an api-key header when no Authorization is present", () => {
    const apiKeyLog = parseHar(
      JSON.stringify({
        log: {
          entries: [
            {
              request: {
                method: "GET",
                url: "https://k.test/x",
                headers: [{ name: "X-API-Key", value: "abc" }],
                queryString: [],
                cookies: [],
              },
              response: { status: 200, statusText: "OK", headers: [], content: { mimeType: "" } },
            },
          ],
        },
      }),
    );
    expect(inferApi(apiKeyLog).auth).toEqual({ type: "apiKey", in: "header", name: "X-API-Key" });
  });
});
