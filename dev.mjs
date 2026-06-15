// Dev server: run the canvas as a plain webpage with watch + live reload.
//
// Instead of the Copilot CLI opening the canvas, we open an instance ourselves
// (src/canvas.ts is SDK-free — see esbuild.config.mjs#devCanvasConfig) and put a
// tiny HTTP server in front of it:
//   • GET /, /main.js, /main.css, /favicon.svg → served from disk, and the page
//     gets a small live-reload client injected.
//   • GET /__livereload → SSE channel; the browser reloads whenever esbuild
//     rebuilds web/.
//   • everything else (GET /events SSE, POST /action) → proxied to the opened
//     canvas instance, so the real run-loading / polling / action logic runs.
//
// Edits under web/ hot-reload the browser. Edits under src/ rebuild .dev/ but,
// because the server already imported the canvas module, take effect only after
// restarting `npm run dev`.
//
// Usage:
//   npm run dev                      # browse recent runs of the current repo
//   npm run dev -- owner/repo        # browse recent runs of a repo
//   npm run dev -- owner/repo 123    # open a specific run id
//   npm run dev -- <run-url>         # open a run by URL
//   PORT=3000 npm run dev            # pick the port (default 4173)

import * as esbuild from "esbuild";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

import { devCanvasConfig, nodeConfig, webConfig } from "./esbuild.config.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const CANVAS_ID = "actions-workflow-viz";

const FAVICON =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="#2da44e"/><path d="M6.8 10.4 4.6 8.2l1-1 1.2 1.2 3-3 1 1z" fill="#fff"/></svg>`;

const LIVERELOAD_CLIENT =
    `<script>(()=>{const s=new EventSource("/__livereload");` +
    `s.onmessage=(e)=>{if(e.data==="reload")location.reload();};})();</script>`;

// ── Open args → canvas input ────────────────────────────────────────────────
function parseInput(argv) {
    const args = argv.filter((a) => !a.startsWith("-"));
    if (args.length === 0) return {};
    if (/^https?:\/\//.test(args[0])) return { runUrl: args[0] };
    const input = {};
    if (args[0]?.includes("/")) input.repo = args[0];
    if (args[1] != null) input.runId = args[1];
    return input;
}

// ── Live reload ─────────────────────────────────────────────────────────────
const reloadClients = new Set();
function triggerReload() {
    for (const res of reloadClients) {
        try {
            res.write("data: reload\n\n");
        } catch {
            /* subscriber gone */
        }
    }
}

// esbuild plugin: fire the browser reload after a successful (non-initial)
// rebuild of the watched web bundle.
const reloadPlugin = {
    name: "dev-reload",
    setup(build) {
        let first = true;
        build.onEnd((result) => {
            if (result.errors.length) {
                process.stderr.write(`[web] build failed (${result.errors.length} errors)\n`);
                return;
            }
            if (first) {
                first = false;
                return;
            }
            process.stderr.write("[web] rebuilt — reloading browser\n");
            triggerReload();
        });
    },
};

// ── Static serving ──────────────────────────────────────────────────────────
async function serveFile(res, file, type) {
    try {
        const body = await readFile(file);
        res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
        res.end(body);
    } catch {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end(`Not found: ${file}. Has the first build finished?`);
    }
}

async function serveIndex(res) {
    try {
        const html = (await readFile(join(ROOT, "index.html"), "utf8")).replace(
            "</body>",
            `    ${LIVERELOAD_CLIENT}\n    </body>`,
        );
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
    } catch (e) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(String(e));
    }
}

// ── Proxy /events + /action to the opened canvas instance ───────────────────
function proxy(upstream, req, res) {
    const upstreamReq = http.request(
        {
            hostname: upstream.hostname,
            port: upstream.port,
            path: req.url,
            method: req.method,
            headers: { ...req.headers, host: upstream.host },
        },
        (upstreamRes) => {
            res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
            upstreamRes.pipe(res);
        },
    );
    upstreamReq.on("error", (err) => {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Canvas upstream error: ${err.message}` }));
    });
    req.pipe(upstreamReq);
}

// ── Boot ────────────────────────────────────────────────────────────────────
async function main() {
    // Watch the web bundle (live reload) and keep the committed extension bundle
    // fresh; build the SDK-free canvas bundle that this server imports.
    const webCtx = await esbuild.context({
        ...webConfig,
        plugins: [...(webConfig.plugins ?? []), reloadPlugin],
    });
    const nodeCtx = await esbuild.context(nodeConfig);
    const canvasCtx = await esbuild.context(devCanvasConfig);

    await canvasCtx.rebuild(); // .dev/canvas.mjs must exist before we import it
    await Promise.all([webCtx.watch(), nodeCtx.watch(), canvasCtx.watch()]);

    const canvasModule = await import(pathToFileURL(join(ROOT, ".dev", "canvas.mjs")).href);
    const { canvas } = canvasModule;

    const input = parseInput(process.argv.slice(2));
    const { url } = await canvas.open({
        sessionId: "dev",
        extensionId: `${CANVAS_ID}-dev`,
        canvasId: CANVAS_ID,
        instanceId: "dev",
        input,
    });
    const upstream = new URL(url);

    const server = http.createServer((req, res) => {
        const path = (req.url ?? "/").split("?")[0];

        if (req.method === "GET" && (path === "/" || path === "/index.html")) {
            return void serveIndex(res);
        }
        if (req.method === "GET" && path === "/__livereload") {
            res.writeHead(200, {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
            });
            res.write(":ok\n\n");
            reloadClients.add(res);
            req.on("close", () => reloadClients.delete(res));
            return;
        }
        if (req.method === "GET" && path === "/main.js") {
            return void serveFile(res, join(ROOT, "web", "main.js"), "text/javascript; charset=utf-8");
        }
        if (req.method === "GET" && path === "/main.css") {
            return void serveFile(res, join(ROOT, "web", "main.css"), "text/css; charset=utf-8");
        }
        if (req.method === "GET" && path === "/favicon.svg") {
            res.writeHead(200, { "Content-Type": "image/svg+xml" });
            return void res.end(FAVICON);
        }
        // /events (SSE), /action (POST), and anything else → the canvas instance.
        return void proxy(upstream, req, res);
    });

    await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
    const local = `http://localhost:${PORT}`;
    const target = input.runUrl || input.repo || "current repo (browse mode)";
    process.stderr.write(`\nactions-workflow-viz dev server\n  ${local}  →  ${target}\n`);
    process.stderr.write("  editing web/ live-reloads · editing src/ needs a restart\n\n");

    if (!process.env.NO_OPEN && process.platform === "darwin") {
        spawn("open", [local], { stdio: "ignore", detached: true }).unref();
    }
}

main().catch((err) => {
    process.stderr.write(`dev server failed: ${err?.stack || err}\n`);
    process.exit(1);
});
