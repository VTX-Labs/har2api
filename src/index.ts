/**
 * @vtx-labs/har2api — programmatic API.
 *
 * Turn a browser `.har` capture into an OpenAPI 3.1 spec, a Postman collection,
 * and cURL commands. Pure, offline, and dependency-free: it parses the HAR,
 * infers endpoints (templating dynamic path segments), infers JSON Schemas from
 * the bodies it saw, and redacts captured secrets before they reach any output.
 *
 * @example
 * ```ts
 * import { convert } from "@vtx-labs/har2api";
 * import { readFileSync } from "node:fs";
 *
 * const { openapiYaml, postmanJson } = convert(readFileSync("capture.har", "utf8"));
 * console.log(openapiYaml);
 * ```
 */

export { convert } from "./convert.js";
export type { ConvertOptions, ConvertResult } from "./convert.js";

export { parseHar, HarParseError } from "./har.js";
export type {
  HarLog,
  HarEntry,
  HarRequest,
  HarResponse,
  HarContent,
  HarPostData,
  HarNameValue,
} from "./har.js";

export { inferApi } from "./infer.js";
export type {
  ApiModel,
  OperationModel,
  ResponseModel,
  ParamModel,
  AuthScheme,
  InferOptions,
} from "./infer.js";

export { inferSchema } from "./schema.js";
export type { JsonSchema } from "./schema.js";

export { toOpenApi } from "./openapi.js";
export type { OpenApiOptions } from "./openapi.js";

export { toPostman } from "./postman.js";
export { toCurl, toCurlCommand } from "./curl.js";

export {
  isSensitiveHeader,
  isSensitiveParam,
  isSensitiveKey,
  redactHeaderValue,
  redactJson,
  REDACTED,
} from "./redact.js";
