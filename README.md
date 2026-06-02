```
██╗  ██╗  █████╗  ██████╗  ██████╗   █████╗  ██████╗  ██╗
██║  ██║ ██╔══██╗ ██╔══██╗ ╚════██╗ ██╔══██╗ ██╔══██╗ ██║
███████║ ███████║ ██████╔╝  █████╔╝ ███████║ ██████╔╝ ██║
██╔══██║ ██╔══██║ ██╔══██╗ ██╔═══╝  ██╔══██║ ██╔═══╝  ██║
██║  ██║ ██║  ██║ ██║  ██║ ███████╗ ██║  ██║ ██║      ██║
╚═╝  ╚═╝ ╚═╝  ╚═╝ ╚═╝  ╚═╝ ╚══════╝ ╚═╝  ╚═╝ ╚═╝      ╚═╝
```

# har2api

**Turn a browser `.har` capture into an OpenAPI 3.1 spec, a Postman collection, and cURL commands — offline.**

[![npm](https://img.shields.io/npm/v/@vtx-labs/har2api?color=3182ce)](https://www.npmjs.com/package/@vtx-labs/har2api)
[![CI](https://github.com/VTX-Labs/har2api/actions/workflows/ci.yml/badge.svg)](https://github.com/VTX-Labs/har2api/actions)
[![Docs](https://img.shields.io/badge/docs-API_reference-3182ce)](https://vtx-labs.github.io/har2api/)
[![License: MIT](https://img.shields.io/badge/License-MIT-3182ce.svg)](LICENSE)
[![Zero dependencies](https://img.shields.io/badge/dependencies-0-3182ce)](package.json)

---

You already have the network log. Open DevTools → **Network** → **Save all as HAR**,
and `har2api` reverse-engineers the API out of it: it groups the requests into
endpoints, templates the dynamic path segments, infers JSON Schemas from the
bodies it saw, detects the auth scheme, and **redacts your captured tokens** so
the spec is safe to share. No browser automation, no cloud, no signup.

```console
$ har2api capture.har -o openapi.yaml
wrote openapi.yaml
✓ 7 operations across 1 server
  server: https://api.example.com
  auth:   http bearer
```

```yaml
# openapi.yaml (excerpt)
paths:
  /v1/users/{userId}:
    get:
      parameters:
        - { name: userId, in: path, required: true, schema: { type: string } }
      responses:
        "200":
          content:
            application/json:
              schema:
                type: object
                properties:
                  id: { type: integer, example: 42 }
                  email: { type: string, format: email }
                  token: { type: string, example: <redacted> }   # secret never echoed
```

## Quick start

```bash
npx @vtx-labs/har2api capture.har                       # OpenAPI 3.1 YAML to stdout
npx @vtx-labs/har2api capture.har -o openapi.yaml       # write a file
npx @vtx-labs/har2api capture.har -f postman -o api.postman.json
npx @vtx-labs/har2api capture.har -f curl --host api.example.com
pbpaste | npx @vtx-labs/har2api -                        # pipe a HAR in via stdin
```

Or add it to a project: `pnpm add -D @vtx-labs/har2api`

### Getting a HAR file

In Chrome, Edge, or Firefox: open **DevTools → Network**, use the app so the
calls you care about fire, then right-click the request list → **Save all as
HAR with content** (Firefox: the gear/save icon). That file is the input.

## How it's different from PlayCapture, Postman import, etc.

| | har2api |
| :-- | :-- |
| **Offline** | Pure local parsing — nothing is uploaded, no headless browser. |
| **Scriptable** | A single CLI + library; drop it in CI, a Makefile, or a script. |
| **Secret-safe** | Auth headers, `api_key`-style params, and `password`/`token` body fields are redacted by default. |
| **Zero dependencies** | The published package ships no runtime dependencies. |
| **Three formats, one pass** | OpenAPI 3.1 (YAML or JSON), Postman v2.1, and cURL from the same inference. |

## CLI

```
har2api <capture.har> [options]
har2api - [options]                # read the HAR from stdin

  -f, --format <fmt>     openapi (YAML, default) | openapi-json | postman | curl
  -o, --out <file>       Write to a file instead of stdout
      --title <name>     Title for the generated OpenAPI document
      --api-version <v>  Version string for the OpenAPI info block (default: 1.0.0)
      --host <hosts>     Only include these hosts (comma-separated; drops 3rd-party noise)
      --keep-assets      Include static assets (images, css, js — dropped by default)
  -h, --help             Show help
  -v, --version          Show version
```

| Exit code | Meaning                                              |
| :-------- | :--------------------------------------------------- |
| `0`       | Conversion succeeded                                 |
| `1`       | The HAR had no usable API requests after filtering   |
| `2`       | Usage error, file not found, or invalid HAR          |

The conversion summary is written to **stderr**, so piping `stdout` gives you a
clean spec:

```bash
har2api capture.har | npx @redocly/cli lint -   # validate the generated spec
```

## Programmatic API

The library half is pure and dependency-free.

```ts
import { convert } from "@vtx-labs/har2api";
import { readFileSync } from "node:fs";

const { openapiYaml, model } = convert(readFileSync("capture.har", "utf8"), {
  includeHosts: ["api.example.com"],
  title: "My API",
});

console.log(openapiYaml);
console.log(`${model.operations.length} operations, auth: ${model.auth.type}`);
```

| Export                          | Description                                                    |
| :------------------------------ | :------------------------------------------------------------- |
| `convert(har, options?)`        | HAR string → `{ model, openapi, openapiYaml, openapiJson, postman, postmanJson, curl }` |
| `parseHar(har)`                 | Parse + validate a HAR document → `HarLog`                     |
| `inferApi(log, options?)`       | Reduce HAR entries to a structured `ApiModel`                  |
| `inferSchema(samples)`          | Infer a JSON Schema from one or more example values            |
| `toOpenApi(model, options?)`    | `ApiModel` → OpenAPI 3.1 document                              |
| `toPostman(model, name?)`       | `ApiModel` → Postman Collection v2.1                           |
| `toCurl(model)`                 | `ApiModel` → cURL commands                                     |
| `redactJson(value)`             | Mask secret-looking fields in a parsed body                    |

## How it works

1. **Parse** the HAR (defensively — one malformed entry is skipped, not fatal).
2. **Filter** to the hosts you care about and drop static assets (`--keep-assets`
   to keep them).
3. **Group** requests by method + a *templated* path: numeric ids, UUIDs, and
   long token-like segments collapse into `{param}` (named from the preceding
   collection, e.g. `/users/42` → `/users/{userId}`).
4. **Infer** JSON Schemas by merging every body sample seen for an endpoint —
   fields present in all samples are `required`, sometimes-`null` fields become
   nullable, small sets of string values become `enum`s, and dates/uuids/emails
   get a `format`.
5. **Redact** before emitting: `Authorization` keeps its scheme but loses the
   credential; `api_key`/`token`/`password`-style query and body values are
   replaced with `<redacted>`. Your real secrets never reach the output.
6. **Emit** OpenAPI 3.1 (YAML or JSON), a Postman v2.1 collection, and cURL.

> **Security note.** A HAR almost always contains live credentials and PII.
> har2api redacts known secret shapes, but always review generated output before
> sharing it, and never commit raw `.har` files — this repo's `.gitignore`
> blocks them.

## License

[MIT](LICENSE) © [VTX Labs](https://vtxlabs.dev)

<div align="center">
<sub>Built by <a href="https://vtxlabs.dev">VTX Labs</a> · <a href="https://github.com/VTX-Labs">GitHub</a> · <a href="https://x.com/vtxlabs">@vtxlabs</a></sub>
</div>
