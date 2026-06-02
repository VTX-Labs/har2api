/**
 * JSON Schema inference.
 *
 * Given one or more example JSON values (request or response bodies observed in
 * the capture), infer a JSON Schema (draft compatible with OpenAPI 3.1, which
 * uses JSON Schema 2020-12). Merging multiple samples sharpens the result:
 * a field present in every sample is `required`; a field that is sometimes
 * `null` becomes nullable; a string field with few distinct values becomes an
 * `enum`.
 */

/** A minimal JSON Schema node — the subset we emit. */
export interface JsonSchema {
  type?: string | string[];
  format?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: Array<string | number | boolean>;
  example?: unknown;
  nullable?: boolean;
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Internal accumulator that tracks what we've seen across all samples. */
interface Acc {
  types: Set<string>;
  /** For objects: per-key accumulator + how many object samples had the key. */
  props: Map<string, { acc: Acc; seen: number }>;
  /** Number of object samples (denominator for required detection). */
  objectSamples: number;
  /** For arrays: a single merged accumulator across all elements. */
  items: Acc | null;
  /** Distinct primitive values seen, capped — used for enum detection. */
  values: Set<string | number | boolean>;
  valuesOverflowed: boolean;
  /** A representative example value (first non-null seen). */
  example: unknown;
  hasExample: boolean;
}

const MAX_ENUM_VALUES = 12;

function newAcc(): Acc {
  return {
    types: new Set(),
    props: new Map(),
    objectSamples: 0,
    items: null,
    values: new Set(),
    valuesOverflowed: false,
    example: undefined,
    hasExample: false,
  };
}

function jsonType(v: Json): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "object") return "object";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v; // "string" | "boolean"
}

function accumulate(acc: Acc, value: Json): void {
  const t = jsonType(value);
  acc.types.add(t);

  if (!acc.hasExample && value !== null) {
    acc.example = value;
    acc.hasExample = true;
  }

  if (t === "object") {
    acc.objectSamples++;
    const obj = value as { [k: string]: Json };
    for (const [k, v] of Object.entries(obj)) {
      let entry = acc.props.get(k);
      if (!entry) {
        entry = { acc: newAcc(), seen: 0 };
        acc.props.set(k, entry);
      }
      entry.seen++;
      accumulate(entry.acc, v);
    }
  } else if (t === "array") {
    if (!acc.items) acc.items = newAcc();
    for (const el of value as Json[]) accumulate(acc.items, el);
  } else if (t === "string" || t === "integer" || t === "number" || t === "boolean") {
    if (!acc.valuesOverflowed) {
      acc.values.add(value as string | number | boolean);
      if (acc.values.size > MAX_ENUM_VALUES) acc.valuesOverflowed = true;
    }
  }
}

/** A handful of well-known string formats worth annotating. */
function detectFormat(values: Set<string | number | boolean>): string | undefined {
  const strings = [...values].filter((v): v is string => typeof v === "string");
  if (strings.length === 0) return undefined;
  const all = (re: RegExp) => strings.every((s) => re.test(s));
  if (all(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) return "date-time";
  if (all(/^\d{4}-\d{2}-\d{2}$/)) return "date";
  if (all(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) return "uuid";
  if (all(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)) return "email";
  if (all(/^https?:\/\/\S+$/)) return "uri";
  return undefined;
}

function nonNullTypes(types: Set<string>): string[] {
  return [...types].filter((t) => t !== "null").sort();
}

function build(acc: Acc): JsonSchema {
  const nullable = acc.types.has("null");
  const concrete = nonNullTypes(acc.types);

  // No concrete type ever seen (only nulls) — leave the type open.
  if (concrete.length === 0) {
    return nullable ? { type: "null" } : {};
  }

  const schema: JsonSchema = {};
  // "integer" and "number" can coexist (some samples whole, some fractional);
  // collapse to the wider "number".
  let typeList = concrete;
  if (typeList.includes("integer") && typeList.includes("number")) {
    typeList = typeList.filter((t) => t !== "integer");
  }
  // typeList is non-empty here (concrete.length >= 1, and the integer/number
  // collapse only ever removes one of two entries).
  const primary = typeList[0] as string;
  schema.type = typeList.length === 1 ? primary : typeList;

  if (primary === "object" && concrete.length === 1) {
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const [key, { acc: child, seen }] of acc.props) {
      properties[key] = build(child);
      if (acc.objectSamples > 0 && seen === acc.objectSamples) required.push(key);
    }
    if (Object.keys(properties).length > 0) schema.properties = properties;
    if (required.length > 0) schema.required = required.sort();
  } else if (primary === "array" && concrete.length === 1) {
    schema.items = acc.items ? build(acc.items) : {};
  } else {
    // Scalar: maybe a format, maybe an enum.
    const format = detectFormat(acc.values);
    if (format) schema.format = format;
    const onlyStringsOrNumbers = typeList.every(
      (t) => t === "string" || t === "integer" || t === "number" || t === "boolean",
    );
    if (
      onlyStringsOrNumbers &&
      !acc.valuesOverflowed &&
      acc.values.size > 1 &&
      acc.values.size <= MAX_ENUM_VALUES &&
      // Don't enum free-form formatted strings (dates, uuids, …).
      !format
    ) {
      schema.enum = [...acc.values].sort((a, b) =>
        String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0,
      );
    }
    if (acc.hasExample && schema.enum === undefined) schema.example = acc.example;
  }

  if (nullable) schema.nullable = true;
  return schema;
}

/**
 * Infer a JSON Schema from one or more example values. Pass every sample you
 * have for the same endpoint/body — more samples yield a tighter schema.
 * Returns an empty schema (`{}`) when no samples are provided.
 */
export function inferSchema(samples: readonly unknown[]): JsonSchema {
  if (samples.length === 0) return {};
  const acc = newAcc();
  for (const s of samples) accumulate(acc, s as Json);
  return build(acc);
}
