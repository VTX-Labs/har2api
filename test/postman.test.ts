import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseHar } from "../src/har.js";
import { inferApi } from "../src/infer.js";
import { toPostman } from "../src/postman.js";

const fixture = readFileSync(fileURLToPath(new URL("./fixtures/sample.har", import.meta.url)), "utf8");
const model = inferApi(parseHar(fixture));

interface PostmanItem {
  name: string;
  request: {
    method: string;
    url: { path: string[]; query?: Array<{ key: string; value: string; disabled: boolean }>; variable?: Array<{ key: string }> };
    body?: { mode: string; raw: string };
  };
}

describe("toPostman", () => {
  const collection = toPostman(model);

  it("uses the v2.1 schema", () => {
    expect(collection.info.schema).toContain("v2.1.0");
  });

  it("creates one item per operation", () => {
    expect(collection.item).toHaveLength(model.operations.length);
  });

  it("converts {userId} into a Postman :userId variable", () => {
    const item = (collection.item as PostmanItem[]).find((i) => i.name.includes("{userId}"))!;
    expect(item.request.url.path).toContain(":userId");
    expect(item.request.url.variable?.some((v) => v.key === "userId")).toBe(true);
  });

  it("disables non-required query params and never writes secret values", () => {
    const list = (collection.item as PostmanItem[]).find((i) => i.name === "GET /v1/users")!;
    const apiKey = list.request.url.query?.find((q) => q.key === "api_key");
    expect(apiKey?.disabled).toBe(true); // not required
    expect(apiKey?.value).toBe(""); // sensitive -> blank
  });

  it("includes a raw JSON body for POST built from a redacted sample", () => {
    const create = (collection.item as PostmanItem[]).find((i) => i.name === "POST /v1/users")!;
    expect(create.request.body?.mode).toBe("raw");
    expect(create.request.body?.raw).toContain("<redacted>"); // password masked
    expect(create.request.body?.raw).toContain("new@u.com");
  });

  it("configures bearer auth at the collection level with a placeholder", () => {
    expect(collection.auth).toMatchObject({ type: "bearer" });
    expect(JSON.stringify(collection.auth)).toContain("{{token}}");
  });

  it("exposes a baseUrl collection variable", () => {
    expect(collection.variable).toEqual([{ key: "baseUrl", value: "https://api.example.com" }]);
  });
});
