// Generate only the viewer recommendation contract and its recursive dependencies.
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import openapiTS from "openapi-typescript";

const { load } = createRequire(import.meta.resolve("openapi-typescript"))("js-yaml");
const root = fileURLToPath(new URL("../..", import.meta.url));
const input = process.env.PLATFORM_OPENAPI || "../platform/api/openapi.yaml";
const document = load(/^https?:\/\//.test(input) ? await (await fetch(input)).text() : await readFile(resolve(root, input), "utf8"));
const paths = {};
const components = {};
const seen = new Set();
function refs(node) {
  if (!node || typeof node !== "object") return;
  if (typeof node.$ref === "string") {
    const match = /^#\/components\/([^/]+)\/([^/]+)$/.exec(node.$ref);
    if (!match) throw new Error("Unsupported external recommendation reference");
    const [, group, name] = match, key = group + "/" + name;
    if (!seen.has(key)) {
      seen.add(key);
      const value = document.components?.[group]?.[name];
      if (!value) throw new Error("Missing recommendation dependency: " + key);
      (components[group] ??= {})[name] = value;
      refs(value);
    }
  }
  for (const value of Object.values(node)) refs(value);
}
for (const path of ["/v1/migration-recommendations", "/v1/migration-recommendations/status"]) {
  if (!document.paths?.[path]) throw new Error("Missing recommendation endpoint: " + path);
  paths[path] = document.paths[path];
  refs(paths[path]);
}
await writeFile(resolve(root, "src/api/recommendations-schema.d.ts"), await openapiTS({ openapi: document.openapi, info: document.info, paths, components }));
process.stdout.write("gen:recommendations-api: generated viewer endpoints from " + input + "\n");
