#!/usr/bin/env node
/**
 * har2api CLI — turn a .har capture into an OpenAPI 3.1 spec, a Postman
 * collection, and cURL commands.
 *
 * Exit codes:
 *   0  conversion succeeded
 *   1  the HAR had no usable API requests after filtering
 *   2  usage error, file not found, or invalid HAR
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { banner } from "./banner.js";
import { c } from "./colors.js";
import { convert, type ConvertOptions } from "./convert.js";
import { HarParseError } from "./har.js";

const VERSION = "0.1.0";

type Format = "openapi" | "openapi-json" | "postman" | "curl";

interface Flags {
  input?: string;
  format: Format;
  out?: string;
  title?: string;
  apiVersion?: string;
  hosts: string[];
  keepAssets: boolean;
  help: boolean;
  version: boolean;
}

function parseArgs(argv: string[]): Flags {
  const f: Flags = {
    format: "openapi",
    hosts: [],
    keepAssets: false,
    help: false,
    version: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "-h":
      case "--help":
        f.help = true;
        break;
      case "-v":
      case "--version":
        f.version = true;
        break;
      case "-f":
      case "--format":
        f.format = parseFormat(requireValue(argv, ++i, a as string));
        break;
      case "-o":
      case "--out":
        f.out = requireValue(argv, ++i, a as string);
        break;
      case "--title":
        f.title = requireValue(argv, ++i, a as string);
        break;
      case "--api-version":
        f.apiVersion = requireValue(argv, ++i, a as string);
        break;
      case "--host":
        f.hosts.push(
          ...requireValue(argv, ++i, a as string)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        );
        break;
      case "--keep-assets":
        f.keepAssets = true;
        break;
      default:
        if (a !== undefined && a.startsWith("-")) {
          fail(`Unknown option: ${a}\nRun \`har2api --help\` for usage.`);
        } else if (a !== undefined) {
          if (f.input !== undefined) fail(`Unexpected argument: ${a} (input already set to ${f.input}).`);
          f.input = a;
        }
    }
  }
  return f;
}

function parseFormat(value: string): Format {
  switch (value) {
    case "openapi":
    case "yaml":
      return "openapi";
    case "openapi-json":
    case "json":
      return "openapi-json";
    case "postman":
      return "postman";
    case "curl":
      return "curl";
    default:
      fail(`Unknown format: ${value}. Expected one of: openapi, openapi-json, postman, curl.`);
  }
}

function requireValue(argv: string[], i: number, flag: string): string {
  const v = argv[i];
  if (v === undefined || v.startsWith("-")) fail(`Option ${flag} expects a value.`);
  return v as string;
}

function fail(msg: string): never {
  process.stderr.write(`${c.red("error")} ${msg}\n`);
  process.exit(2);
}

function help(): void {
  const b = c.bold;
  process.stdout.write(`
${banner("HAR capture → OpenAPI, Postman, cURL · by VTX Labs")}
${b("har2api")} ${c.dim("v" + VERSION)} — turn a .har capture into an API spec

${b("Usage")}
  har2api <capture.har> [options]
  har2api - [options]                ${c.dim("# read the HAR from stdin")}

${b("Options")}
  -f, --format <fmt>     openapi ${c.dim("(YAML, default)")} | openapi-json | postman | curl
  -o, --out <file>       Write to a file instead of stdout
      --title <name>     Title for the generated OpenAPI document
      --api-version <v>  Version string for the OpenAPI info block ${c.dim("(default: 1.0.0)")}
      --host <hosts>     Only include these hosts ${c.dim("(comma-separated; drops 3rd-party noise)")}
      --keep-assets      Include static assets ${c.dim("(images, css, js — dropped by default)")}
  -h, --help             Show this help
  -v, --version          Show version

${b("Examples")}
  har2api capture.har                         ${c.dim("# OpenAPI 3.1 YAML to stdout")}
  har2api capture.har -o openapi.yaml
  har2api capture.har -f postman -o api.postman.json
  har2api capture.har -f curl --host api.example.com
  pbpaste | har2api -                          ${c.dim("# pipe a HAR in")}

${c.dim("har2api is offline and redacts captured secrets — your tokens never leave your machine.")}
${c.dim("Built by VTX Labs · https://vtxlabs.dev")}
`);
}

function readInput(input: string | undefined): string {
  if (input === undefined) {
    fail("No input. Pass a .har file path, or `-` to read from stdin.\nRun `har2api --help` for usage.");
  }
  if (input === "-") {
    try {
      return readFileSync(0, "utf8"); // fd 0 = stdin
    } catch (err) {
      fail(`Could not read HAR from stdin: ${(err as Error).message}`);
    }
  }
  const abs = resolve(process.cwd(), input);
  if (!existsSync(abs)) fail(`File not found: ${input}`);
  try {
    return readFileSync(abs, "utf8");
  } catch (err) {
    fail(`Could not read ${input}: ${(err as Error).message}`);
  }
}

function selectOutput(result: ReturnType<typeof convert>, format: Format): string {
  switch (format) {
    case "openapi":
      return result.openapiYaml;
    case "openapi-json":
      return result.openapiJson;
    case "postman":
      return result.postmanJson;
    case "curl":
      return result.curl;
  }
}

function summary(result: ReturnType<typeof convert>): void {
  const err = process.stderr;
  const { model } = result;
  const opCount = model.operations.length;
  const server = model.servers[0] ?? "(no absolute server URL found)";
  err.write(`${c.green("✓")} ${c.bold(`${opCount} operation${opCount === 1 ? "" : "s"}`)} across ${model.servers.length || 1} server\n`);
  err.write(`  ${c.dim("server:")} ${server}\n`);
  const authLabel =
    model.auth.type === "none"
      ? "none detected"
      : model.auth.type === "http"
        ? `http ${model.auth.scheme}`
        : `apiKey (${model.auth.in}: ${model.auth.name})`;
  err.write(`  ${c.dim("auth:  ")} ${authLabel}\n`);
}

function main(): void {
  const flags = parseArgs(process.argv.slice(2));

  if (flags.help) return help();
  if (flags.version) {
    process.stdout.write(VERSION + "\n");
    return;
  }

  const harJson = readInput(flags.input);

  const opts: ConvertOptions = {};
  if (flags.title !== undefined) opts.title = flags.title;
  if (flags.apiVersion !== undefined) opts.version = flags.apiVersion;
  if (flags.hosts.length > 0) opts.includeHosts = flags.hosts;
  if (flags.keepAssets) opts.dropAssets = false;

  let result: ReturnType<typeof convert>;
  try {
    result = convert(harJson, opts);
  } catch (err) {
    if (err instanceof HarParseError) fail(err.message);
    throw err;
  }

  if (result.model.operations.length === 0) {
    process.stderr.write(
      `${c.yellow("!")} No API requests found after filtering.\n` +
        `  ${c.dim("Try --keep-assets, or --host to widen which hosts are included.")}\n`,
    );
    process.exit(1);
  }

  const output = selectOutput(result, flags.format);

  if (flags.out !== undefined) {
    const abs = resolve(process.cwd(), flags.out);
    writeFileSync(abs, output, "utf8");
    process.stderr.write(`${c.green("wrote")} ${flags.out}\n`);
    summary(result);
  } else {
    process.stdout.write(output);
    // Summary goes to stderr so piped stdout stays clean (the spec only).
    if (process.stderr.isTTY) summary(result);
  }
}

try {
  main();
} catch (err) {
  fail((err as Error).message ?? String(err));
}
