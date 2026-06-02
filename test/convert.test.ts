import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { convert } from "../src/convert.js";
import { HarParseError } from "../src/har.js";

const fixture = readFileSync(fileURLToPath(new URL("./fixtures/sample.har", import.meta.url)), "utf8");

describe("convert", () => {
  const result = convert(fixture);

  it("produces every artifact from one HAR", () => {
    expect(result.model.operations.length).toBeGreaterThan(0);
    expect(result.openapi.openapi).toBe("3.1.0");
    expect(result.openapiYaml).toContain("openapi: 3.1.0");
    expect(result.openapiJson).toContain('"openapi": "3.1.0"');
    expect(result.postman.info.schema).toContain("v2.1.0");
    expect(result.postmanJson).toContain("v2.1.0");
    expect(result.curl).toContain("curl -X");
  });

  it("yields YAML that parses back into the same document as the JSON", () => {
    expect(parseYaml(result.openapiYaml)).toEqual(JSON.parse(result.openapiJson));
  });

  it("never leaks captured secrets into any artifact", () => {
    const everything = [result.openapiYaml, result.openapiJson, result.postmanJson, result.curl].join("\n");
    expect(everything).not.toContain("abc.def.ghi"); // bearer token
    expect(everything).not.toContain("SECRET123"); // api_key value
    expect(everything).not.toContain("hunter2"); // request password
    expect(everything).not.toContain("leakme"); // response token
  });

  it("threads options through to inference and the OpenAPI info block", () => {
    const r = convert(fixture, { title: "Custom", version: "9.9.9", includeHosts: ["api.example.com"] });
    expect(r.openapi.info).toMatchObject({ title: "Custom", version: "9.9.9" });
    expect(r.model.servers).toEqual(["https://api.example.com"]);
  });

  it("throws HarParseError on bad input", () => {
    expect(() => convert("not a har")).toThrow(HarParseError);
  });
});
