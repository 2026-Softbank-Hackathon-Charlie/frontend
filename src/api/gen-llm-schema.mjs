// Generate only the additive LLM contract, leaving unrelated legacy API types unchanged.
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import openapiTS from "openapi-typescript";

// Reuse the official generator's existing YAML parser; no extra package is installed.
const { load } = createRequire(import.meta.resolve("openapi-typescript"))("js-yaml");
const root = fileURLToPath(new URL("../..", import.meta.url));
const input = process.env.PLATFORM_OPENAPI || "../platform/api/openapi.yaml";
const document = load(/^https?:\/\//.test(input) ? await (await fetch(input)).text() : await readFile(resolve(root, input), "utf8"));
const path = "/v1/apps/{name}/llm-observability";
if (!document.paths?.[path]) throw new Error("The platform contract has no LLM observation endpoint");
const components = {};
const seen = new Set();
function refs(node) {
  if (!node || typeof node !== "object") return;
  if (typeof node.$ref === "string") {
    const match = /^#\/components\/([^/]+)\/([^/]+)$/.exec(node.$ref);
    if (!match) throw new Error("Unsupported external reference in the LLM contract");
    const [, group, name] = match, key = group + "/" + name;
    if (!seen.has(key)) {
      seen.add(key);
      const value = document.components?.[group]?.[name];
      if (!value) throw new Error("Missing LLM contract dependency: " + key);
      (components[group] ??= {})[name] = value;
      refs(value);
    }
  }
  for (const value of Object.values(node)) refs(value);
}
refs(document.paths[path]);
const fragment = { openapi: document.openapi, info: document.info, paths: { [path]: document.paths[path] }, components };
await writeFile(resolve(root, "src/api/llm-schema.d.ts"), await openapiTS(fragment));
process.stdout.write("gen:llm-api: generated the endpoint and referenced schemas from " + input + "\n");
