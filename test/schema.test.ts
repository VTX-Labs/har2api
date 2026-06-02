import { describe, expect, it } from "vitest";
import { inferSchema } from "../src/schema.js";

describe("inferSchema", () => {
  it("returns an empty schema for no samples", () => {
    expect(inferSchema([])).toEqual({});
  });

  it("infers scalar types", () => {
    expect(inferSchema(["hi"]).type).toBe("string");
    expect(inferSchema([true]).type).toBe("boolean");
    expect(inferSchema([42]).type).toBe("integer");
    expect(inferSchema([4.2]).type).toBe("number");
  });

  it("collapses integer + number to number", () => {
    expect(inferSchema([1, 2.5]).type).toBe("number");
  });

  it("infers object properties and required keys", () => {
    const s = inferSchema([
      { id: 1, name: "a" },
      { id: 2, name: "b", extra: true },
    ]);
    expect(s.type).toBe("object");
    expect(Object.keys(s.properties!)).toEqual(expect.arrayContaining(["id", "name", "extra"]));
    // id and name appear in every sample -> required; extra does not.
    expect(s.required).toEqual(["id", "name"]);
  });

  it("infers array item schemas by merging elements", () => {
    const s = inferSchema([[{ a: 1 }, { a: 2 }]]);
    expect(s.type).toBe("array");
    expect(s.items?.type).toBe("object");
    expect(s.items?.properties?.["a"]?.type).toBe("integer");
  });

  it("marks a field nullable when sometimes null", () => {
    const s = inferSchema([{ v: "x" }, { v: null }]);
    expect(s.properties?.["v"]?.nullable).toBe(true);
  });

  it("detects common string formats", () => {
    expect(inferSchema(["2026-06-02T10:00:00Z"]).format).toBe("date-time");
    expect(inferSchema(["2026-06-02"]).format).toBe("date");
    expect(inferSchema(["a@b.com"]).format).toBe("email");
    expect(inferSchema(["https://x.test/y"]).format).toBe("uri");
    expect(inferSchema(["9f8e7d6c-1234-4abc-89de-0123456789ab"]).format).toBe("uuid");
  });

  it("infers an enum for a small set of distinct strings", () => {
    const s = inferSchema([{ role: "admin" }, { role: "user" }, { role: "admin" }]);
    expect(s.properties?.["role"]?.enum).toEqual(["admin", "user"]);
  });

  it("does not enum a single repeated value (uses example instead)", () => {
    const s = inferSchema([{ role: "admin" }, { role: "admin" }]);
    expect(s.properties?.["role"]?.enum).toBeUndefined();
    expect(s.properties?.["role"]?.example).toBe("admin");
  });

  it("does not enum formatted strings", () => {
    const s = inferSchema(["a@b.com", "c@d.com", "e@f.com"]);
    expect(s.enum).toBeUndefined();
    expect(s.format).toBe("email");
  });

  it("does not enum when there are too many distinct values", () => {
    const samples = Array.from({ length: 20 }, (_, i) => ({ k: `v${i}` }));
    expect(inferSchema(samples).properties?.["k"]?.enum).toBeUndefined();
  });
});
