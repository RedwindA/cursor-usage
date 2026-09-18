import { context, build } from "esbuild";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeIcon } from "./png.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = resolve(root, "extension");
const watch = process.argv.includes("--watch");

const common = {
  bundle: true,
  format: "iife",
  target: "chrome114",
  sourcemap: true,
  minify: false,
  logLevel: "info",
};

const entries = [
  { entryPoints: [resolve(root, "src/content/index.ts")], outfile: resolve(outdir, "content.js") },
  { entryPoints: [resolve(root, "src/bridge/index.ts")], outfile: resolve(outdir, "page-bridge.js") },
  { entryPoints: [resolve(root, "src/background/index.ts")], outfile: resolve(outdir, "background.js") },
];

function copyStatic() {
  mkdirSync(resolve(outdir, "styles"), { recursive: true });
  mkdirSync(resolve(outdir, "icons"), { recursive: true });
  cpSync(resolve(root, "src/styles/panel.css"), resolve(outdir, "styles/panel.css"));
  writeFileSync(resolve(outdir, "icons/icon16.png"), makeIcon(16));
  writeFileSync(resolve(outdir, "icons/icon48.png"), makeIcon(48));
  writeFileSync(resolve(outdir, "icons/icon128.png"), makeIcon(128));
}

async function run() {
  copyStatic();
  if (watch) {
    const ctxs = await Promise.all(entries.map((item) => context({ ...common, ...item })));
    await Promise.all(ctxs.map((ctx) => ctx.watch()));
    console.log("watching...");
    return;
  }
  await Promise.all(entries.map((item) => build({ ...common, ...item })));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
