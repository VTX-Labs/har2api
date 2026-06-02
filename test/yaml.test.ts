import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { toYaml } from "../src/yaml.js";

/**
 * The emitter is validated by round-tripping through a real YAML parser: for
 * any JSON-compatible value, `parse(toYaml(v))` must deep-equal `v`. This is a
 * stronger guarantee than asserting on exact whitespace.
 */
function roundTrips(value: unknown): void {
  const text = toYaml(value);
  expect(parseYaml(text)).toEqual(value);
}

describe("toYaml round-trips", () => {
  it("scalars", () => {
    roundTrips("hello");
    roundTrips(42);
    roundTrips(3.14);
    roundTrips(true);
    roundTrips(false);
    roundTrips(null);
  });

  it("strings that need quoting", () => {
    roundTrips({ a: "" });
    roundTrips({ a: "true" }); // would-be boolean
    roundTrips({ a: "123" }); // would-be number
    roundTrips({ a: "with: colon" });
    roundTrips({ a: "  leading space" });
    roundTrips({ a: "line1\nline2" });
    roundTrips({ a: "tab\there" });
    roundTrips({ a: '#hash-leading' });
    roundTrips({ a: "[bracket]" });
  });

  it("nested objects", () => {
    roundTrips({ a: { b: { c: 1 }, d: "x" }, e: true });
  });

  it("arrays of scalars", () => {
    roundTrips({ list: [1, 2, 3], names: ["a", "b"] });
  });

  it("arrays of objects (block style)", () => {
    roundTrips({
      parameters: [
        { name: "id", in: "path", required: true },
        { name: "page", in: "query", required: false, schema: { type: "string", example: "1" } },
      ],
    });
  });

  it("empty containers", () => {
    roundTrips({ obj: {}, arr: [] });
    roundTrips([]);
    roundTrips({});
  });

  it("a representative OpenAPI fragment", () => {
    roundTrips({
      openapi: "3.1.0",
      info: { title: "x", version: "1.0.0" },
      paths: {
        "/users/{id}": {
          get: {
            parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: { id: { type: "integer", example: 1 }, tags: { type: "array", items: { type: "string" } } },
                      required: ["id"],
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
  });
});
