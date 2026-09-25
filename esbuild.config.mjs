import esbuild from "esbuild";
import process from "node:process";
import builtins from "builtin-modules";
import { fileURLToPath } from "node:url";

const production = process.argv[2] === "production";
const contexts = await Promise.all([
  esbuild.context({
    entryPoints: [fileURLToPath(new URL("./src/main.ts", import.meta.url))],
    bundle: true,
    external: ["obsidian", "electron", ...builtins],
    format: "cjs",
    target: "es2022",
    logLevel: "info",
    sourcemap: production ? false : "inline",
    treeShaking: true,
    outfile: fileURLToPath(new URL("./main.js", import.meta.url)),
  }),
  esbuild.context({
    entryPoints: [fileURLToPath(new URL("./src/mcp-server.ts", import.meta.url))],
    bundle: true,
    external: ["mammoth"],
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "info",
    sourcemap: production ? false : "inline",
    outfile: fileURLToPath(new URL("./mcp-server.mjs", import.meta.url)),
  }),
]);

if (production) {
  await Promise.all(contexts.map((context) => context.rebuild()));
  await Promise.all(contexts.map((context) => context.dispose()));
} else {
  await Promise.all(contexts.map((context) => context.watch()));
}
