// esbuild driver: two committed bundles.
//
//   1. src/extension.ts → extension.mjs — the Node entry the CLI loads. The
//      Copilot SDK is marked external (CLI auto-resolves it; never bundle).
//      Octokit + @actions/workflow-parser (which pulls in yaml) are bundled in
//      so the extension is a single self-contained ESM file with no runtime
//      node_modules dependency.
//   2. web/main.tsx → web/main.js (+ web/main.css) — the React + Primer app,
//      served by the loopback server at /main.js and /main.css. React, Primer,
//      the primitives theme CSS, and Motion (motion/react) are all bundled in
//      (local assets, no CDN). esbuild emits the sibling main.css automatically
//      because main.tsx imports CSS.
//
// Configs live in esbuild.config.mjs and are shared with dev.mjs.
//
// Usage: `npm run build`   (one-shot, both bundles)
//        `npm run watch`   (rebuild both on change — live dev)
//        `npm run dev`     (watch + serve in a browser — see dev.mjs)

import * as esbuild from "esbuild";
import { nodeConfig, webConfig } from "./esbuild.config.mjs";

if (process.argv.includes("--watch")) {
    const nodeCtx = await esbuild.context(nodeConfig);
    const webCtx = await esbuild.context(webConfig);
    await Promise.all([nodeCtx.watch(), webCtx.watch()]);
    process.stderr.write("watching src/ and web/ for changes…\n");
} else {
    await Promise.all([esbuild.build(nodeConfig), esbuild.build(webConfig)]);
}
