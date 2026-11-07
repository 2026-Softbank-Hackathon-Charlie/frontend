// Project non-secret migration metadata from the canonical platform contract.
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import openapiTS from "openapi-typescript";
const { load } = createRequire(import.meta.resolve("openapi-typescript"))("js-yaml");
const root = fileURLToPath(new URL("../..", import.meta.url));
const input = process.env.PLATFORM_OPENAPI || "../platform/api/openapi.yaml";
const document = load(/^https?:\/\//.test(input) ? await (await fetch(input)).text() : await readFile(resolve(root, input), "utf8"));
const schemas = {};
for (const [name, fields] of [["PlanEndpoint"], ["PlanSummary"], ["Run", ["runId", "planRef", "app", "source", "target"]]]) {
  const schema = document.components?.schemas?.[name];
  if (!schema) throw new Error("Missing migration metadata schema: " + name);
  schemas[name] = fields ? { ...schema, required: schema.required.filter(key => fields.includes(key)), properties: Object.fromEntries(fields.map(key => {
    if (!schema.properties[key]) throw new Error("Missing migration metadata: " + name + "." + key);
    return [key, schema.properties[key]];
  })) } : schema;
}
await writeFile(resolve(root, "src/api/migration-context-schema.d.ts"), await openapiTS({ openapi: document.openapi, info: document.info, paths: {}, components: { schemas } }));
process.stdout.write("Generated canonical PlanEndpoint/PlanSummary and non-secret Run metadata from " + input + "\n");
