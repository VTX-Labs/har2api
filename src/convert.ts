/**
 * Top-level conversion: a HAR string in, all artifacts out.
 *
 * This is the one function most programmatic users need. It chains the parse →
 * infer → emit pipeline and hands back the model plus every output format, so
 * callers can pick what they want without re-running inference.
 */

import { toCurl } from "./curl.js";
import { parseHar } from "./har.js";
import { inferApi, type ApiModel, type InferOptions } from "./infer.js";
import { toOpenApi, type OpenApiOptions } from "./openapi.js";
import { toPostman } from "./postman.js";
import { toYaml } from "./yaml.js";

/** Options for {@link convert}. */
export interface ConvertOptions extends InferOptions, OpenApiOptions {
  /** Optional name for the Postman collection. Defaults to the host. */
  collectionName?: string;
}

/** Everything produced from one HAR file. */
export interface ConvertResult {
  /** The intermediate API model — useful for custom emitters. */
  model: ApiModel;
  /** OpenAPI 3.1 document (object form). */
  openapi: ReturnType<typeof toOpenApi>;
  /** OpenAPI 3.1 as a YAML string. */
  openapiYaml: string;
  /** OpenAPI 3.1 as a pretty-printed JSON string. */
  openapiJson: string;
  /** Postman Collection v2.1 (object form). */
  postman: ReturnType<typeof toPostman>;
  /** Postman Collection v2.1 as a pretty-printed JSON string. */
  postmanJson: string;
  /** cURL commands, one block per operation. */
  curl: string;
}

/**
 * Convert a HAR document (JSON string) into an OpenAPI 3.1 spec, a Postman
 * collection, and cURL commands.
 *
 * @throws {@link HarParseError} if the input is not a usable HAR document.
 */
export function convert(harJson: string, options: ConvertOptions = {}): ConvertResult {
  const log = parseHar(harJson);

  const inferOpts: InferOptions = {};
  if (options.includeHosts !== undefined) inferOpts.includeHosts = options.includeHosts;
  if (options.dropAssets !== undefined) inferOpts.dropAssets = options.dropAssets;
  const model = inferApi(log, inferOpts);

  const oasOpts: OpenApiOptions = {};
  if (options.title !== undefined) oasOpts.title = options.title;
  if (options.version !== undefined) oasOpts.version = options.version;
  if (options.description !== undefined) oasOpts.description = options.description;
  const openapi = toOpenApi(model, oasOpts);

  const postman = toPostman(model, options.collectionName);

  return {
    model,
    openapi,
    openapiYaml: toYaml(openapi),
    openapiJson: JSON.stringify(openapi, null, 2) + "\n",
    postman,
    postmanJson: JSON.stringify(postman, null, 2) + "\n",
    curl: toCurl(model),
  };
}
