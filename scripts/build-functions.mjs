// Bundles each functions/<name>/src/main.ts (with @backroom/core inlined) into functions/<name>/dist/main.mjs,
// because an Appwrite Function deploys one folder and can't resolve workspace packages.
import { build } from "esbuild";
import { existsSync, readdirSync } from "node:fs";

const fns = existsSync("functions") ? readdirSync("functions").filter((f) => existsSync(`functions/${f}/src/main.ts`)) : [];
for (const fn of fns) {
  await build({
    entryPoints: [`functions/${fn}/src/main.ts`],
    outfile: `functions/${fn}/dist/main.mjs`, // .mjs: the deployed folder has no package.json to mark it ESM
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    // Everything is bundled: a deployed Function folder has no node_modules.
    banner: { js: "import { createRequire } from \"module\"; const require = createRequire(import.meta.url);" },
  });
}
console.log(`built ${fns.length} function(s)`);
