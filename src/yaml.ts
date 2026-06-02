/**
 * Minimal YAML serializer for the JSON-shaped documents we emit (OpenAPI).
 *
 * A full YAML library would be the single largest dependency in the project for
 * a feature we use one-directionally (we only ever *write* YAML, from plain
 * JSON values). This emitter handles exactly that subset — objects, arrays,
 * strings, numbers, booleans, null — with correct quoting and block style. It
 * is not a general-purpose YAML writer and is intentionally not exported.
 */

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const INDENT = "  ";

/** Whether a scalar string can be emitted unquoted in YAML flow. */
function needsQuoting(s: string): boolean {
  if (s === "") return true;
  // Reserved indicators, would-be booleans/nulls/numbers, leading/trailing space.
  if (/^[\s]|[\s]$/.test(s)) return true;
  if (/^(true|false|null|yes|no|on|off|~)$/i.test(s)) return true;
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return true;
  // Characters that change meaning at the start of a scalar, or anywhere.
  if (/^[!&*?|>%@`"'#,\[\]{}-]/.test(s)) return true;
  if (/[:#]/.test(s) && /[:#]\s|\s[:#]|[:#]$/.test(` ${s} `)) return true;
  if (/[\n\t]/.test(s)) return true;
  return false;
}

function quoteScalar(s: string): string {
  if (!needsQuoting(s)) return s;
  // Double-quote and escape so multiline / control chars survive a round-trip.
  const escaped = s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    .replace(/\r/g, "\\r");
  return `"${escaped}"`;
}

function scalar(v: null | boolean | number | string): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "null";
  return quoteScalar(v);
}

function isScalar(v: Json): v is null | boolean | number | string {
  return v === null || typeof v !== "object";
}

/**
 * Emit an object as an array element in block style: the first scalar key sits
 * on the `- ` dash line, the remaining keys align one level deeper.
 */
function emitObjectInArray(
  obj: { [k: string]: Json },
  pad: string,
  depth: number,
  lines: string[],
): void {
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
  if (entries.length === 0) {
    lines.push(`${pad}- {}`);
    return;
  }
  // The element body is indented at depth+1; the dash occupies the first two
  // columns of that indentation ("- " is exactly one INDENT wide).
  const childPad = INDENT.repeat(depth + 1);
  const first = entries[0]!;
  const [firstKey, firstVal] = first;
  const k0 = quoteScalar(firstKey);

  if (isScalar(firstVal)) {
    lines.push(`${pad}- ${k0}: ${scalar(firstVal)}`);
  } else if (Array.isArray(firstVal)) {
    lines.push(`${pad}- ${k0}:`);
    emit(firstVal, depth + 1, lines);
  } else {
    lines.push(`${pad}- ${k0}:`);
    emit(firstVal, depth + 2, lines);
  }

  for (let i = 1; i < entries.length; i++) {
    const [key, v] = entries[i]!;
    const k = quoteScalar(key);
    if (isScalar(v)) {
      lines.push(`${childPad}${k}: ${scalar(v)}`);
    } else if (Array.isArray(v)) {
      lines.push(`${childPad}${k}:`);
      emit(v, depth + 1, lines);
    } else {
      lines.push(`${childPad}${k}:`);
      emit(v, depth + 2, lines);
    }
  }
}

function emit(value: Json, depth: number, lines: string[]): void {
  const pad = INDENT.repeat(depth);

  if (Array.isArray(value)) {
    if (value.length === 0) {
      lines[lines.length - 1] += " []";
      return;
    }
    for (const item of value) {
      if (isScalar(item)) {
        lines.push(`${pad}- ${scalar(item)}`);
      } else if (Array.isArray(item)) {
        lines.push(`${pad}-`);
        emit(item, depth + 1, lines);
      } else {
        // Object element: render the first key on the dash line, the rest
        // indented to align beneath it — the conventional block style.
        emitObjectInArray(item, pad, depth, lines);
      }
    }
    return;
  }

  // Object. (Arrays returned above; callers never pass a scalar to emit().)
  const obj = value as { [k: string]: Json };
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
  if (entries.length === 0) {
    lines[lines.length - 1] += " {}";
    return;
  }
  for (const [key, v] of entries) {
    const k = quoteScalar(key);
    if (isScalar(v)) {
      lines.push(`${pad}${k}: ${scalar(v)}`);
    } else if (Array.isArray(v)) {
      lines.push(`${pad}${k}:`);
      emit(v, depth, lines); // arrays are indented at the same level as the key
    } else {
      lines.push(`${pad}${k}:`);
      emit(v, depth + 1, lines);
    }
  }
}

/** Serialize a JSON-compatible value to a YAML string. */
export function toYaml(value: unknown): string {
  const lines: string[] = [];
  const root = value as Json;
  if (isScalar(root)) return scalar(root) + "\n";
  // Seed a line so a top-level empty object/array can append to it.
  lines.push("");
  emit(root, 0, lines);
  // Drop the seed if it was only used as an anchor for a non-empty container.
  if (lines[0] === "") lines.shift();
  return lines.join("\n") + "\n";
}
