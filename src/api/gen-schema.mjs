// Generates src/api/schema.d.ts from the platform OpenAPI contract.
//
//   npm run gen:api                                    ../platform/api/openapi.yaml
//   PLATFORM_OPENAPI=<path or http(s) URL> npm run gen:api
//
// openapi-typescript 6 is used on purpose: version 7 needs the TypeScript 5
// compiler API, and this project is on TypeScript 7, which does not ship it.
import { writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import openapiTS from "openapi-typescript";

const root = fileURLToPath(new URL("../..", import.meta.url));
const input = process.env.PLATFORM_OPENAPI || "../platform/api/openapi.yaml";
const source = /^https?:\/\//.test(input) ? new URL(input) : pathToFileURL(resolve(root, input));
const out = resolve(root, "src/api/schema.d.ts");

const ts = await openapiTS(source);
await writeFile(out, ts);
console.log(`gen:api: wrote src/api/schema.d.ts from ${input}`);
