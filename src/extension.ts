// actions-workflow-viz — a live GitHub Actions run visualizer canvas.
//
// Opens a side-panel canvas that renders a workflow run as a job dependency
// DAG, colored by live status, and polls the Actions API until the run
// finishes. Job edges come from the workflow YAML's `needs:`; node colors come
// from the live jobs API. Data is fetched via Octokit (auth: GITHUB_TOKEN /
// GH_TOKEN, falling back to the `gh` CLI token).

import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";

import {
    CanvasError,
    createCanvas,
    joinSession,
    type CopilotSession,
    type LogOptions,
    type MessageAttachment,
} from "@github/copilot-sdk/extension";

import {
    cancelRun,
    fetchRunGraph,
    parseRunRef,
    reRunAllJobs,
    reRunFailedJobs,
    reRunJob,
} from "./run-data.js";
import { getOctokit } from "./github.js";
import type { CanvasState, GraphNode, RunGraph, RunRef } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

type LogFn = (message: string, opts?: LogOptions) => void;

interface Instance {
    instanceId: string;
    server: http.Server;
    url: string;
    ref: RunRef | null;
    state: CanvasState;
    subscribers: Set<http.ServerResponse>;
    timer: ReturnType<typeof setTimeout> | null;
    polling: boolean;
    gen: number;
}

interface LoadInput {
    repo?: string;
    runId?: number | string;
    runUrl?: string;
}

const instances = new Map<string, Instance>();

const POLL_MS = 1200;

function emptyState(): CanvasState {
    return { status: "idle", message: "Open a run to begin.", run: null, updatedAt: null };
}

function broadcast(entry: Instance): void {
    const payload = `data: ${JSON.stringify(entry.state)}\n\n`;
    for (const res of entry.subscribers) {
        try {
            res.write(payload);
        } catch {
            /* subscriber gone; cleaned up on close */
        }
    }
}

async function startServer(instanceId: string): Promise<Instance> {
    const entry: Instance = {
        instanceId,
        server: null as unknown as http.Server,
        url: "",
        ref: null,
        state: emptyState(),
        subscribers: new Set(),
        timer: null,
        polling: false,
        gen: 0,
    };

    const server = http.createServer(async (req, res) => {
        try {
            if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
                const html = await readFile(join(__dirname, "index.html"));
                res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
                res.end(html);
                return;
            }
            if (req.method === "GET" && req.url === "/anim.js") {
                const js = await readFile(join(__dirname, "web", "anim.js"));
                res.writeHead(200, {
                    "Content-Type": "text/javascript; charset=utf-8",
                    "Cache-Control": "max-age=3600",
                });
                res.end(js);
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
            if (req.method === "GET" && req.url === "/favicon.svg") {
                const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="#2da44e"/><path d="M6.8 10.4 4.6 8.2l1-1 1.2 1.2 3-3 1 1z" fill="#fff"/></svg>`;
                res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "max-age=86400" });
                res.end(svg);
                return;
            }
            if (req.method === "GET" && req.url === "/favicon.ico") {
                res.writeHead(204);
                res.end();
                return;
            }
            if (req.method === "POST" && req.url === "/action") {
                let body = "";
                req.on("data", (c) => {
                    body += c;
                });
                req.on("end", async () => {
                    try {
                        const { action, input } = JSON.parse(body || "{}") as {
                            action?: string;
                            input?: unknown;
                        };
                        if (action === "addContext") {
                            const result = await addJobContext(
                                entry,
                                input as ContextInput | undefined,
                            );
                            res.writeHead(200, { "Content-Type": "application/json" });
                            res.end(JSON.stringify(result));
                            return;
                        }
                        if (
                            action === "rerun_all" ||
                            action === "rerun_failed" ||
                            action === "cancel_run" ||
                            action === "rerun_job"
                        ) {
                            const result = await runMutation(
                                entry,
                                action,
                                input as MutationInput | undefined,
                            );
                            res.writeHead(200, { "Content-Type": "application/json" });
                            res.end(JSON.stringify(result));
                            return;
                        }
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ error: `Unknown action: ${action}` }));
                    } catch (err) {
                        const status = err instanceof CanvasError ? 400 : 500;
                        res.writeHead(status, { "Content-Type": "application/json" });
                        res.end(
                            JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
                        );
                    }
                });
                return;
            }
            res.writeHead(404);
            res.end();
        } catch (err) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
    });

    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const { port } = server.address() as AddressInfo;
    entry.server = server;
    entry.url = `http://127.0.0.1:${port}/`;
    return entry;
}

function getEntry(instanceId: string): Instance {
    const entry = instances.get(instanceId);
    if (!entry) {
        throw new CanvasError(
            "canvas_instance_not_found",
            `No open canvas for instanceId=${instanceId}. Call open_canvas first.`,
        );
    }
    return entry;
}

function stopPolling(entry: Instance): void {
    if (entry.timer) {
        clearTimeout(entry.timer);
        entry.timer = null;
    }
}

async function pollOnce(entry: Instance, log: LogFn | undefined, gen: number): Promise<void> {
    // Superseded by a newer load_run before we even started — bail.
    if (!entry.ref || entry.gen !== gen) return;
    const ref = entry.ref;
    entry.polling = true;
    try {
        const run = await fetchRunGraph(ref);
        // A newer load_run superseded this poll while it was in flight — discard.
        if (entry.gen !== gen) return;
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
            entry.timer = setTimeout(() => void pollOnce(entry, log, gen), POLL_MS);
        }
    } catch (err) {
        if (entry.gen !== gen) return;
        const message = err instanceof Error ? err.message : String(err);
        entry.state = { status: "error", message, run: entry.state.run, updatedAt: Date.now() };
        broadcast(entry);
        log?.(`workflow-viz poll error: ${message}`, { level: "warn" });
        // Back off but keep trying on transient failures while a run is active.
        stopPolling(entry);
        entry.timer = setTimeout(() => void pollOnce(entry, log, gen), POLL_MS * 2);
    } finally {
        if (entry.gen === gen) entry.polling = false;
    }
}

async function loadRun(instanceId: string, input: LoadInput | undefined, log?: LogFn) {
    const entry = getEntry(instanceId);
    let ref: RunRef;
    try {
        ref = parseRunRef(input || {});
    } catch (e) {
        throw new CanvasError("canvas_input_invalid", e instanceof Error ? e.message : String(e));
    }
    entry.ref = ref;
    const gen = ++entry.gen; // invalidate any in-flight or scheduled poll
    entry.state = {
        status: "loading",
        message: `Loading ${ref.repo} run #${ref.runId}…`,
        run: null,
        updatedAt: Date.now(),
    };
    broadcast(entry);
    stopPolling(entry);
    entry.polling = false;
    await pollOnce(entry, log, gen);
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

const FAIL_CONCLUSIONS = new Set(["failure", "timed_out"]);

// Pull numeric job ids out of a node's legs (per-job URLs end in /job/<id>),
// falling back to the node's own url.
function allJobIds(node: GraphNode): string[] {
    const ids = new Set<string>();
    for (const leg of node.legs) ids.add(String(leg.id));
    if (!ids.size) {
        const id = node.html_url?.match(/job\/(\d+)/)?.[1];
        if (id) ids.add(id);
    }
    return [...ids];
}

function nodeById(run: RunGraph, jobId?: string): GraphNode | undefined {
    if (!jobId) return undefined;
    return run.nodes.find((n) => n.id === jobId);
}

const LOG_TAIL_CHARS = 16_000;

function tail(text: string, max: number): string {
    if (text.length <= max) return text;
    return `… (truncated, showing last ${max} chars) …\n${text.slice(text.length - max)}`;
}

interface LogTarget {
    jobId: string;
    displayName: string;
}

// Shared core: best-effort download of raw job logs as base64 blob
// attachments. Never throws — any failure yields fewer (or no) attachments.
async function fetchLogs(
    repo: string,
    targets: LogTarget[],
    label: string,
    log?: LogFn,
): Promise<MessageAttachment[]> {
    const [owner, name] = repo.split("/");
    if (!owner || !name || !targets.length) return [];
    let octokit: Awaited<ReturnType<typeof getOctokit>>;
    try {
        octokit = await getOctokit();
    } catch {
        return [];
    }
    const attachments: MessageAttachment[] = [];
    for (const target of targets) {
        try {
            const { data } = await octokit.rest.actions.downloadJobLogsForWorkflowRun({
                owner,
                repo: name,
                job_id: Number(target.jobId),
            });
            const text = typeof data === "string" ? data : String(data ?? "");
            if (!text.trim()) continue;
            attachments.push({
                type: "blob",
                data: Buffer.from(tail(text, LOG_TAIL_CHARS), "utf8").toString("base64"),
                mimeType: "text/plain",
                displayName: target.displayName,
            });
        } catch (e) {
            log?.(
                `${label}: failed to fetch logs for job ${target.jobId}: ${
                    e instanceof Error ? e.message : String(e)
                }`,
                { level: "warn" },
            );
        }
    }
    return attachments;
}

function fetchJobLogs(run: RunGraph, node: GraphNode, log?: LogFn): Promise<MessageAttachment[]> {
    const targets = allJobIds(node).map((jobId) => ({ jobId, displayName: `${node.label}.log` }));
    return fetchLogs(run.repo, targets, "addContext", log);
}

function stepIcon(s: { status: string; conclusion: string | null }): string {
    if (s.status !== "completed") return "•";
    return FAIL_CONCLUSIONS.has(s.conclusion ?? "") ? "✗" : "✓";
}

interface ContextInput {
    jobId?: string;
}

async function addJobContext(entry: Instance, input: ContextInput | undefined) {
    const run = entry.state.run;
    if (!run) {
        throw new CanvasError("canvas_input_invalid", "No run loaded yet.");
    }
    const node = nodeById(run, input?.jobId);
    if (!node) {
        throw new CanvasError("canvas_input_invalid", "Job not found in this run.");
    }
    const attachments = await fetchJobLogs(run, node, sessionLog);
    const logs = attachments.map((a) => ({
        name: a.type === "blob" ? a.displayName : "",
        text: a.type === "blob" ? Buffer.from(a.data, "base64").toString("utf8") : "",
    }));
    const workflow = run.name ?? run.display_title;
    const runLabel = run.run_number != null ? `#${run.run_number}` : `run ${run.id}`;
    const steps = node.legs
        .flatMap((leg) => leg.steps ?? [])
        .map((s) => ({
            name: s.name,
            status: s.status,
            conclusion: s.conclusion,
            outcome: stepIcon(s),
        }));
    const payload = {
        job: node.label,
        status: node.status,
        conclusion: node.conclusion ?? null,
        workflow,
        run: `${workflow} ${runLabel}`,
        runId: run.id,
        repo: run.repo,
        url: node.html_url ?? null,
        steps,
        logs,
    };
    const title = `${node.label} — ${workflow} ${runLabel}`;
    try {
        await sessionPushAttachments?.({
            instanceId: entry.instanceId,
            attachments: [{ type: "extension_context", title, payload }],
        });
    } catch (e) {
        sessionLog?.(`addContext push failed: ${e instanceof Error ? e.message : String(e)}`, {
            level: "warn",
        });
        throw new CanvasError("canvas_internal", "Failed to stage job context.");
    }
    return { ok: true, job: node.label, staged: true, logsAttached: logs.length };
}

type MutationKind = "rerun_all" | "rerun_failed" | "cancel_run" | "rerun_job";

interface MutationInput {
    jobId?: string;
}

// Shared core for the write actions: validate a run is loaded, call the matching
// data-layer helper (translating failures to CanvasError so the POST handler
// returns HTTP 400 with a surfaceable message), then immediately repaint by
// reusing the poll/SSE machinery — re-runs flip the run back to in_progress,
// which restarts polling on its own.
async function runMutation(entry: Instance, kind: MutationKind, input?: MutationInput) {
    const run = entry.state.run;
    if (!run) {
        throw new CanvasError("canvas_input_invalid", "No run loaded yet.");
    }
    const ref: RunRef = { repo: run.repo, runId: run.id };
    try {
        if (kind === "rerun_all") {
            await reRunAllJobs(ref);
        } else if (kind === "rerun_failed") {
            await reRunFailedJobs(ref);
        } else if (kind === "cancel_run") {
            await cancelRun(ref);
        } else {
            const node = nodeById(run, input?.jobId);
            if (!node) {
                throw new CanvasError("canvas_input_invalid", "Job not found in this run.");
            }
            const jobId = allJobIds(node)[0];
            if (!jobId) {
                throw new CanvasError(
                    "canvas_input_invalid",
                    "This job has no re-runnable job id yet.",
                );
            }
            await reRunJob(run.repo, Number(jobId));
        }
    } catch (e) {
        if (e instanceof CanvasError) throw e;
        throw new CanvasError("canvas_action_failed", e instanceof Error ? e.message : String(e));
    }
    const gen = ++entry.gen; // supersede any in-flight poll, then poll now
    stopPolling(entry);
    entry.polling = false;
    await pollOnce(entry, sessionLog, gen);
    return { ok: true, kind, runStatus: entry.state.run?.status ?? null };
}

const loadInputSchema = {
    type: "object",
    properties: {
        repo: { type: "string", description: "Repository in 'owner/repo' form." },
        runId: {
            type: ["number", "string"],
            description: "Actions run ID (the numeric run id, not run number).",
        },
        runUrl: {
            type: "string",
            description:
                "Full run URL, e.g. https://github.com/owner/repo/actions/runs/123. Alternative to repo+runId.",
        },
    },
};

let sessionLog: LogFn | undefined;
type PushAttachmentsFn = CopilotSession["rpc"]["extensions"]["sendAttachmentsToMessage"];
let sessionPushAttachments: PushAttachmentsFn | undefined;

const canvas = createCanvas({
    id: "actions-workflow-viz",
    displayName: "Actions Workflow Run",
    description:
        "Visualize a GitHub Actions run as a live job dependency graph, colored by real-time status. Open with { repo, runId } or a run URL.",
    inputSchema: loadInputSchema,
    actions: [
        {
            name: "load_run",
            description:
                "Point the canvas at a GitHub Actions run and start live polling. Accepts { repo, runId } or { runUrl }.",
            inputSchema: loadInputSchema,
            handler: ({ instanceId, input }) => loadRun(instanceId, input as LoadInput, sessionLog),
        },
        {
            name: "refresh",
            description: "Force an immediate refresh of the currently loaded run.",
            handler: async ({ instanceId }) => {
                const entry = getEntry(instanceId);
                if (!entry.ref) {
                    throw new CanvasError("canvas_input_invalid", "No run loaded. Call load_run first.");
                }
                const gen = ++entry.gen; // supersede any in-flight poll, then poll now
                stopPolling(entry);
                entry.polling = false;
                await pollOnce(entry, sessionLog, gen);
                return {
                    status: entry.state.status,
                    runStatus: entry.state.run?.status ?? null,
                    conclusion: entry.state.run?.conclusion ?? null,
                };
            },
        },
        {
            name: "rerun_all",
            description: "Re-run all jobs in the currently loaded run.",
            handler: ({ instanceId }) => runMutation(getEntry(instanceId), "rerun_all"),
        },
        {
            name: "rerun_failed",
            description: "Re-run only the failed jobs in the currently loaded run.",
            handler: ({ instanceId }) => runMutation(getEntry(instanceId), "rerun_failed"),
        },
        {
            name: "cancel_run",
            description: "Cancel the currently loaded run.",
            handler: ({ instanceId }) => runMutation(getEntry(instanceId), "cancel_run"),
        },
        {
            name: "rerun_job",
            description:
                "Re-run a single job (and its dependents) by graph node id. Requires a completed run.",
            inputSchema: {
                type: "object",
                properties: {
                    jobId: { type: "string", description: "Graph node id of the job to re-run." },
                },
                required: ["jobId"],
            },
            handler: ({ instanceId, input }) =>
                runMutation(getEntry(instanceId), "rerun_job", input as MutationInput),
        },
    ],
    open: async ({ instanceId, input }) => {
        let entry = instances.get(instanceId);
        if (!entry) {
            entry = await startServer(instanceId);
            instances.set(instanceId, entry);
        }
        const loadInput = input as LoadInput | undefined;
        // Idempotent: a run passed on open (or rehydrate) loads immediately.
        if (loadInput && (loadInput.repo || loadInput.runUrl)) {
            try {
                await loadRun(instanceId, loadInput, sessionLog);
            } catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                entry.state = { status: "error", message, run: null, updatedAt: Date.now() };
                broadcast(entry);
            }
        }
        const run = entry.state.run;
        return {
            url: entry.url,
            title: run ? `${run.display_title} · ${run.repo}` : "Actions Workflow Run",
            status: run
                ? `${run.status}${run.conclusion ? ` (${run.conclusion})` : ""}`
                : "Waiting for a run",
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
        await new Promise<void>((r) => entry.server.close(() => r()));
    },
});

const session: CopilotSession = await joinSession({ canvases: [canvas] });
sessionLog = (message, opts) => {
    try {
        session.log(message, opts);
    } catch {
        /* logging is best-effort */
    }
};
sessionPushAttachments = (params) => session.rpc.extensions.sendAttachmentsToMessage(params);
