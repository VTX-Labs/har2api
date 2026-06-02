import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseHar } from "../src/har.js";
import { inferApi } from "../src/infer.js";
import { toOpenApi } from "../src/openapi.js";

const fixture = readFileSync(fileURLToPath(new URL("./fixtures/sample.har", import.meta.url)), "utf8");
const model = inferApi(parseHar(fixture));

describe("toOpenApi", () => {
  const doc = toOpenApi(model);

  it("emits a 3.1.0 document with info and servers", () => {
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.title).toContain("api.example.com");
    expect(doc.info.version).toBe("1.0.0");
    expect(doc.servers).toEqual([{ url: "https://api.example.com" }]);
  });

  it("creates a path item per templated path and a method per operation", () => {
    expect(Object.keys(doc.paths).sort()).toEqual(["/v1/users", "/v1/users/{userId}"]);
    expect(Object.keys(doc.paths["/v1/users"]!).sort()).toEqual(["get", "post"]);
  });

  it("emits a required path parameter for {userId}", () => {
    const getById = doc.paths["/v1/users/{userId}"]!["get"] as Record<string, unknown>;
    const params = getById["parameters"] as Array<Record<string, unknown>>;
    const pathParam = params.find((p) => p["in"] === "path");
    expect(pathParam).toMatchObject({ name: "userId", in: "path", required: true });
  });

  it("emits query parameters with correct required flags", () => {
    const list = doc.paths["/v1/users"]!["get"] as Record<string, unknown>;
    const params = list["parameters"] as Array<Record<string, unknown>>;
    expect(params.find((p) => p["name"] === "page")).toMatchObject({ required: true });
    expect(params.find((p) => p["name"] === "api_key")).toMatchObject({ required: false });
  });

  it("emits a request body schema for POST", () => {
    const post = doc.paths["/v1/users"]!["post"] as Record<string, unknown>;
    const body = post["requestBody"] as Record<string, unknown>;
    const content = body["content"] as Record<string, { schema: Record<string, unknown> }>;
    expect(content["application/json"]!.schema["type"]).toBe("object");
  });

  it("emits responses keyed by status with content schemas", () => {
    const getById = doc.paths["/v1/users/{userId}"]!["get"] as Record<string, unknown>;
    const responses = getById["responses"] as Record<string, unknown>;
    expect(Object.keys(responses).sort()).toEqual(["200", "404"]);
  });

  it("adds a security scheme matching the detected auth", () => {
    expect(doc.components?.securitySchemes).toHaveProperty("bearerAuth");
    expect(doc.security).toEqual([{ bearerAuth: [] }]);
  });

  it("respects custom title and version options", () => {
    const custom = toOpenApi(model, { title: "My API", version: "2.3.4", description: "Hi" });
    expect(custom.info).toEqual({ title: "My API", version: "2.3.4", description: "Hi" });
  });
});
