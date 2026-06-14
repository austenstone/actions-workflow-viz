// actions-workflow-viz — a live GitHub Actions run visualizer canvas.
//
// Opens a side-panel canvas that renders a workflow run as a job dependency
// DAG, colored by live status, and polls the Actions API until the run
// finishes. Job edges come from the workflow YAML's `needs:`; node colors come
// from the live jobs API. Auth is handled by the `gh` CLI.

import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

import { CanvasError, createCanvas, joinSession } from "@github/copilot-sdk/extension";

import { fetchRunGraph, parseRunRef } from "./lib/run-data.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// instanceId → { server, url, ref, state, subscribers, timer, polling }
const instances = new Map();

const POLL_MS = 3500;

function emptyState() {
    return { status: "idle", message: "Open a run to begin.", run: null, updatedAt: null };
}

function broadcast(entry) {
    const payload = `data: ${JSON.stringify(entry.state)}\n\n`;
    for (const res of entry.subscribers) {
        try {
            res.write(payload);
        } catch {
            /* subscriber gone; cleaned up on close */
        }
    }
}

async function startServer() {
    const entry = {
        server: null,
        url: null,
        ref: null,
        state: emptyState(),
        subscribers: new Set(),
        timer: null,
        polling: false,
    };

    const server = http.createServer(async (req, res) => {
        try {
            if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
                const html = await readFile(join(__dirname, "index.html"));
                res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
                res.end(html);
                return;
            }
            if (req.method === "GET" && req.url === "/state") {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify(entry.state));
                return;
            }
            if (req.method === "GET" && req.url === "/events") {
                res.writeHead(200, {
                    "Content-Type": "text/event-stream",
                    "Cache-Control": "no-cache",
                    Connection: "keep-alive",
                });
                res.write(`data: ${JSON.stringify(entry.state)}\n\n`);
                entry.subscribers.add(res);
                req.on("close", () => entry.subscribers.delete(res));
                return;
            }
            res.writeHead(404);
            res.end();
        } catch (err) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
    });

    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address();
    entry.server = server;
    entry.url = `http://127.0.0.1:${port}/`;
    return entry;
}

function getEntry(instanceId) {
    const entry = instances.get(instanceId);
    if (!entry) {
        throw new CanvasError(
            "canvas_instance_not_found",
            `No open canvas for instanceId=${instanceId}. Call open_canvas first.`,
        );
    }
    return entry;
}

function stopPolling(entry) {
    if (entry.timer) {
        clearTimeout(entry.timer);
        entry.timer = null;
    }
}

async function pollOnce(entry, log) {
    if (!entry.ref || entry.polling) return;
    entry.polling = true;
    const ref = entry.ref;
    try {
        const run = await fetchRunGraph(ref);
        // A newer load_run superseded this poll while it was in flight — discard.
        if (entry.ref !== ref) return;
        entry.state = {
            status: "ok",
            message: null,
            run,
            updatedAt: Date.now(),
        };
        broadcast(entry);

        // Keep polling only while the run is still active.
        stopPolling(entry);
        if (run.status !== "completed") {
            entry.timer = setTimeout(() => pollOnce(entry, log), POLL_MS);
        }
    } catch (err) {
        if (entry.ref !== ref) return;
        const message = err instanceof Error ? err.message : String(err);
        entry.state = { status: "error", message, run: entry.state.run, updatedAt: Date.now() };
        broadcast(entry);
        log?.(`workflow-viz poll error: ${message}`, { level: "warn" });
        // Back off but keep trying on transient failures while a run is active.
        stopPolling(entry);
        entry.timer = setTimeout(() => pollOnce(entry, log), POLL_MS * 2);
    } finally {
        entry.polling = false;
    }
}

async function loadRun(instanceId, input, log) {
    const entry = getEntry(instanceId);
    let ref;
    try {
        ref = parseRunRef(input || {});
    } catch (e) {
        throw new CanvasError("canvas_input_invalid", e.message);
    }
    entry.ref = ref;
    entry.state = {
        status: "loading",
        message: `Loading ${ref.repo} run #${ref.runId}…`,
        run: null,
        updatedAt: Date.now(),
    };
    broadcast(entry);
    stopPolling(entry);
    await pollOnce(entry, log);
    return {
        status: entry.state.status,
        repo: ref.repo,
        runId: ref.runId,
        runStatus: entry.state.run?.status ?? null,
        conclusion: entry.state.run?.conclusion ?? null,
        nodes: entry.state.run?.nodes?.length ?? 0,
        error: entry.state.status === "error" ? entry.state.message : undefined,
    };
}

const loadInputSchema = {
    type: "object",
    properties: {
        repo: { type: "string", description: "Repository in 'owner/repo' form." },
        runId: { type: ["number", "string"], description: "Actions run ID (the numeric run id, not run number)." },
        runUrl: { type: "string", description: "Full run URL, e.g. https://github.com/owner/repo/actions/runs/123. Alternative to repo+runId." },
    },
};

let sessionLog = null;

const canvas = createCanvas({
    id: "actions-workflow-viz",
    displayName: "Actions Workflow Run",
    description:
        "Visualize a GitHub Actions run as a live job dependency graph, colored by real-time status. Open with { repo, runId } or a run URL.",
    inputSchema: loadInputSchema,
    actions: [
        {
            name: "load_run",
            description: "Point the canvas at a GitHub Actions run and start live polling. Accepts { repo, runId } or { runUrl }.",
            inputSchema: loadInputSchema,
            handler: ({ instanceId, input }) => loadRun(instanceId, input, sessionLog),
        },
        {
            name: "refresh",
            description: "Force an immediate refresh of the currently loaded run.",
            handler: async ({ instanceId }) => {
                const entry = getEntry(instanceId);
                if (!entry.ref) throw new CanvasError("canvas_input_invalid", "No run loaded. Call load_run first.");
                await pollOnce(entry, sessionLog);
                return {
                    status: entry.state.status,
                    runStatus: entry.state.run?.status ?? null,
                    conclusion: entry.state.run?.conclusion ?? null,
                };
            },
        },
    ],
    open: async ({ instanceId, input }) => {
        let entry = instances.get(instanceId);
        if (!entry) {
            entry = await startServer();
            instances.set(instanceId, entry);
        }
        // Idempotent: a run passed on open (or rehydrate) loads immediately.
        if (input && (input.repo || input.runUrl)) {
            try {
                await loadRun(instanceId, input, sessionLog);
            } catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                entry.state = { status: "error", message, run: null, updatedAt: Date.now() };
                broadcast(entry);
            }
        }
        const run = entry.state.run;
        return {
            url: entry.url,
            title: run ? `${run.runName} · ${run.repo}` : "Actions Workflow Run",
            status: run ? `${run.status}${run.conclusion ? ` (${run.conclusion})` : ""}` : "Waiting for a run",
        };
    },
    onClose: async ({ instanceId }) => {
        const entry = instances.get(instanceId);
        if (!entry) return;
        instances.delete(instanceId);
        stopPolling(entry);
        for (const res of entry.subscribers) {
            try {
                res.end();
            } catch {
                /* ignore */
            }
        }
        await new Promise((r) => entry.server.close(() => r()));
    },
});

const session = await joinSession({ canvases: [canvas] });
sessionLog = (message, opts) => {
    try {
        session.log(message, opts);
    } catch {
        /* logging is best-effort */
    }
};
