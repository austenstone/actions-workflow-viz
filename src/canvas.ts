// actions-workflow-viz — a live GitHub Actions run visualizer canvas.
//
// Opens a side-panel canvas that renders a workflow run as a job dependency
// DAG, colored by live status, and polls the Actions API until the run
// finishes. Job edges come from the workflow YAML's `needs:`; node colors come
// from the live jobs API. Data is fetched via Octokit (auth: GITHUB_TOKEN /
// GH_TOKEN, falling back to the `gh` CLI token).
//
// The canvas transport (a loopback HTTP host serving /state, /events SSE,
// /action, and static assets) is provided by copilot-canvas-kit; this module
// only supplies the state shape, static assets, and action handlers.
//
// This module owns the host + canvas wiring but never touches the Copilot SDK
// at runtime. `src/extension.ts` joins the live session and calls bindSession()
// to forward logging/attachment hooks; `dev.mjs` opens an instance directly to
// serve the same app as a plain webpage. The session hooks are optional, so the
// dev path works with no agent attached.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
    CanvasError,
    createCanvasHost,
    type CanvasActionConfig,
    type CanvasAssets,
    type CanvasHost,
} from "copilot-canvas-kit";

import type {
    CopilotSession,
    LogOptions,
    MessageAttachment,
} from "@github/copilot-sdk/extension";

import {
    cancelRun,
    fetchRunGraph,
    parseRunRef,
    reRunAllJobs,
    reRunFailedJobs,
    reRunJob,
} from "./run-data.js";
import { getOctokit, detectRepo } from "./github.js";
import { fetchRunSummaries } from "./workflows.js";
import type { CanvasState, GraphNode, RunGraph, RunPicker, RunRef } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

type LogFn = (message: string, opts?: LogOptions) => void;

// Poll bookkeeping lives beside the canvas (the kit owns the canvas state); this
// tracks the run reference, generation counter, and active timer per instance.
interface Poll {
    ref: RunRef | null;
    gen: number;
    timer: ReturnType<typeof setTimeout> | null;
    polling: boolean;
}

interface LoadInput {
    repo?: string;
    runId?: number | string;
    runUrl?: string;
}

const polls = new Map<string, Poll>();

// Browse-mode picker list, kept beside the canvas state so it survives the
// idle/loading/error transitions the run poller drives. Cleared on a successful
// run load and on close.
const pickers = new Map<string, RunPicker>();

function currentPicker(instanceId: string): RunPicker | null {
    return pickers.get(instanceId) ?? null;
}

function setPicker(instanceId: string, picker: RunPicker | null): void {
    if (picker) pickers.set(instanceId, picker);
    else pickers.delete(instanceId);
}

function pollFor(instanceId: string): Poll {
    let poll = polls.get(instanceId);
    if (!poll) {
        poll = { ref: null, gen: 0, timer: null, polling: false };
        polls.set(instanceId, poll);
    }
    return poll;
}

// Assigned once createCanvasHost runs below; helpers reference it lazily and are
// only ever called from action handlers / poll timers (i.e. after assignment).
let host: CanvasHost<CanvasState>;

// Guarded state accessors — the kit throws if the instance has closed, which can
// race with an in-flight poll, so callers fall back to a no-op / null.
function setState(instanceId: string, next: CanvasState): void {
    if (host.has(instanceId)) host.setState(instanceId, next);
}

function getState(instanceId: string): CanvasState | null {
    return host.has(instanceId) ? host.getState(instanceId) : null;
}

const POLL_MS = 1200;

function emptyState(): CanvasState {
    return { status: "idle", message: "Open a run to begin.", run: null, updatedAt: null, picker: null };
}

const FAVICON_SVG =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="#2da44e"/><path d="M6.8 10.4 4.6 8.2l1-1 1.2 1.2 3-3 1 1z" fill="#fff"/></svg>`;

function stopPolling(poll: Poll): void {
    if (poll.timer) {
        clearTimeout(poll.timer);
        poll.timer = null;
    }
}

async function pollOnce(instanceId: string, log: LogFn | undefined, gen: number): Promise<void> {
    const poll = polls.get(instanceId);
    // Superseded by a newer load_run, or the instance closed — bail.
    if (!poll || !poll.ref || poll.gen !== gen || !host.has(instanceId)) return;
    const ref = poll.ref;
    poll.polling = true;
    try {
        const run = await fetchRunGraph(ref);
        // A newer load_run superseded this poll while it was in flight — discard.
        if (poll.gen !== gen) return;
        setPicker(instanceId, null);
        setState(instanceId, { status: "ok", message: null, run, updatedAt: Date.now() });

        // Keep polling only while the run is still active.
        stopPolling(poll);
        if (run.status !== "completed" && host.has(instanceId)) {
            poll.timer = setTimeout(() => void pollOnce(instanceId, log, gen), POLL_MS);
        }
    } catch (err) {
        if (poll.gen !== gen) return;
        const message = err instanceof Error ? err.message : String(err);
        const prev = getState(instanceId);
        setState(instanceId, {
            status: "error",
            message,
            run: prev?.run ?? null,
            updatedAt: Date.now(),
            picker: currentPicker(instanceId),
        });
        log?.(`workflow-viz poll error: ${message}`, { level: "warn" });
        // Back off but keep trying on transient failures while a run is active.
        stopPolling(poll);
        if (host.has(instanceId)) {
            poll.timer = setTimeout(() => void pollOnce(instanceId, log, gen), POLL_MS * 2);
        }
    } finally {
        if (poll.gen === gen) poll.polling = false;
    }
}

async function loadRun(instanceId: string, input: LoadInput | undefined, log?: LogFn) {
    const poll = pollFor(instanceId);
    let ref: RunRef;
    try {
        ref = parseRunRef(input || {});
    } catch (e) {
        throw new CanvasError("canvas_input_invalid", e instanceof Error ? e.message : String(e));
    }
    poll.ref = ref;
    const gen = ++poll.gen; // invalidate any in-flight or scheduled poll
    setState(instanceId, {
        status: "loading",
        message: `Loading ${ref.repo} run #${ref.runId}…`,
        run: null,
        updatedAt: Date.now(),
    });
    stopPolling(poll);
    poll.polling = false;
    await pollOnce(instanceId, log, gen);
    const st = getState(instanceId);
    return {
        status: st?.status ?? "idle",
        repo: ref.repo,
        runId: ref.runId,
        runStatus: st?.run?.status ?? null,
        conclusion: st?.run?.conclusion ?? null,
        nodes: st?.run?.nodes?.length ?? 0,
        error: st?.status === "error" ? st.message : undefined,
    };
}

interface ListInput {
    repo?: string;
    branch?: string;
}

const PICKER_RUNS = 30;

// Browse mode: stop any run polling and show a clickable list of recent runs.
// Used when the canvas opens with no run, and by the "‹ Runs" back button.
async function listRuns(instanceId: string, input?: ListInput, log?: LogFn) {
    // Stop run polling so a stale poll can't flip state back to "ok".
    const poll = pollFor(instanceId);
    poll.ref = null;
    poll.gen++;
    stopPolling(poll);
    poll.polling = false;

    let repo = input?.repo?.includes("/") ? input.repo : null;
    if (!repo) repo = await detectRepo();

    const base: RunPicker = { repo, runs: [], loading: true, error: null };
    setPicker(instanceId, base);
    setState(instanceId, {
        status: "idle",
        message: null,
        run: null,
        updatedAt: Date.now(),
        picker: base,
    });

    if (!repo) {
        const picker: RunPicker = {
            repo: null,
            runs: [],
            loading: false,
            error: "Couldn't detect a repository. Open with { repo } or pass repo to list_runs.",
        };
        setPicker(instanceId, picker);
        setState(instanceId, {
            status: "idle",
            message: null,
            run: null,
            updatedAt: Date.now(),
            picker,
        });
        return { repo: null, count: 0, error: picker.error };
    }

    try {
        const runs = await fetchRunSummaries(repo, {
            branch: input?.branch,
            perPage: PICKER_RUNS,
        });
        const picker: RunPicker = { repo, runs, loading: false, error: null };
        setPicker(instanceId, picker);
        setState(instanceId, {
            status: "idle",
            message: null,
            run: null,
            updatedAt: Date.now(),
            picker,
        });
        return { repo, count: runs.length };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const picker: RunPicker = { repo, runs: [], loading: false, error: message };
        setPicker(instanceId, picker);
        setState(instanceId, {
            status: "idle",
            message: null,
            run: null,
            updatedAt: Date.now(),
            picker,
        });
        log?.(`workflow-viz list error: ${message}`, { level: "warn" });
        return { repo, count: 0, error: message };
    }
}

// Force an immediate repaint of the loaded run by superseding the current poll
// generation and polling now.
async function refresh(instanceId: string, log?: LogFn) {
    const poll = pollFor(instanceId);
    if (!poll.ref) {
        throw new CanvasError("canvas_input_invalid", "No run loaded. Call load_run first.");
    }
    const gen = ++poll.gen;
    stopPolling(poll);
    poll.polling = false;
    await pollOnce(instanceId, log, gen);
    const st = getState(instanceId);
    return {
        status: st?.status ?? "idle",
        runStatus: st?.run?.status ?? null,
        conclusion: st?.run?.conclusion ?? null,
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

async function addJobContext(instanceId: string, input: ContextInput | undefined) {
    const run = getState(instanceId)?.run;
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
            instanceId,
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
// data-layer helper (translating failures to CanvasError so the action handler
// returns HTTP 400 with a surfaceable message), then immediately repaint by
// reusing the poll machinery — re-runs flip the run back to in_progress, which
// restarts polling on its own.
async function runMutation(instanceId: string, kind: MutationKind, input?: MutationInput) {
    const run = getState(instanceId)?.run;
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
    const poll = pollFor(instanceId);
    const gen = ++poll.gen; // supersede any in-flight poll, then poll now
    stopPolling(poll);
    poll.polling = false;
    await pollOnce(instanceId, sessionLog, gen);
    return { ok: true, kind, runStatus: getState(instanceId)?.run?.status ?? null };
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

// Static files served by the kit's loopback host. The kit reads `file` paths
// itself (and auto-answers /favicon.ico with 204), so we only declare them.
const assets: CanvasAssets = {
    "/": { contentType: "text/html; charset=utf-8", file: join(__dirname, "index.html") },
    "/index.html": {
        contentType: "text/html; charset=utf-8",
        file: join(__dirname, "index.html"),
    },
    "/main.js": {
        contentType: "text/javascript; charset=utf-8",
        file: join(__dirname, "web", "main.js"),
        cacheControl: "max-age=3600",
    },
    "/main.css": {
        contentType: "text/css; charset=utf-8",
        file: join(__dirname, "web", "main.css"),
        cacheControl: "max-age=3600",
    },
    "/favicon.svg": {
        contentType: "image/svg+xml",
        body: FAVICON_SVG,
        cacheControl: "max-age=86400",
    },
};

// Actions reachable from the agent are agent:true; addContext is web-only (the
// JobCard "add to chat" button), so it stays dispatchable over /action but is
// omitted from the agent-facing declaration.
const actions: Record<string, CanvasActionConfig<CanvasState>> = {
    load_run: {
        description:
            "Swap the canvas view to a GitHub Actions run and start live polling. This is how you change which run is shown — call it on the already-open canvas instead of reopening. Accepts { repo, runId } or { runUrl }. Returns the new run status.",
        inputSchema: loadInputSchema,
        agent: true,
        handler: ({ instanceId, input }) => loadRun(instanceId, input as LoadInput, sessionLog),
    },
    refresh: {
        description:
            "Force an immediate refresh of the currently loaded run. A run must already be loaded (via load_run or open).",
        agent: true,
        handler: ({ instanceId }) => refresh(instanceId, sessionLog),
    },
    list_runs: {
        description:
            "Swap the canvas view to browse mode: a clickable list of recent workflow runs the user can pick from. Use this when no specific run is in mind. Repo is auto-detected if omitted. Accepts { repo?, branch? }.",
        inputSchema: {
            type: "object",
            properties: {
                repo: { type: "string", description: "Repository in 'owner/repo' form." },
                branch: { type: "string", description: "Limit to runs on this branch." },
            },
        },
        agent: true,
        handler: ({ instanceId, input }) => listRuns(instanceId, input as ListInput, sessionLog),
    },
    rerun_all: {
        description:
            "Re-run all jobs in the currently loaded run. Requires a run to be loaded first. Returns { ok, kind, runStatus }.",
        agent: true,
        handler: ({ instanceId }) => runMutation(instanceId, "rerun_all"),
    },
    rerun_failed: {
        description:
            "Re-run only the failed jobs in the currently loaded run. Requires a run to be loaded first. Returns { ok, kind, runStatus }.",
        agent: true,
        handler: ({ instanceId }) => runMutation(instanceId, "rerun_failed"),
    },
    cancel_run: {
        description:
            "Cancel the currently loaded run. Requires a run to be loaded first. Returns { ok, kind, runStatus }.",
        agent: true,
        handler: ({ instanceId }) => runMutation(instanceId, "cancel_run"),
    },
    rerun_job: {
        description:
            "Re-run a single job (and its dependents) in the loaded run. Requires a completed run. The jobId is a graph node id from the rendered run state (node.id in the current graph), not the GitHub job number. Returns { ok, kind, runStatus }.",
        inputSchema: {
            type: "object",
            properties: {
                jobId: {
                    type: "string",
                    description:
                        "Graph node id of the job to re-run, taken from the rendered run graph state.",
                },
            },
            required: ["jobId"],
        },
        agent: true,
        handler: ({ instanceId, input }) =>
            runMutation(instanceId, "rerun_job", input as MutationInput),
    },
    addContext: {
        description: "Stage a job's logs and metadata as chat context.",
        inputSchema: {
            type: "object",
            properties: {
                jobId: { type: "string", description: "Graph node id of the job to add." },
            },
            required: ["jobId"],
        },
        handler: ({ instanceId, input }) => addJobContext(instanceId, input as ContextInput),
    },
};

host = createCanvasHost<CanvasState>({
    id: "actions-workflow-viz",
    initialState: emptyState,
    assets,
    actions,
});

const canvas = host.toCanvas({
    displayName: "Actions Workflow Run",
    description:
        "Visualize a GitHub Actions run as a live job dependency graph, colored by real-time status. Open with { repo, runId } or a run URL (or open with nothing to land in browse mode). Open the canvas once, then drive it with actions: load_run to swap which run is shown, list_runs to browse, refresh/rerun_*/cancel_run to act on the loaded run. Each open instance is independent and polls on its own.",
    inputSchema: loadInputSchema,
    onOpen: async ({ instanceId, input }) => {
        const loadInput = input as LoadInput | undefined;
        // A run needs repo+runId (or a runUrl) to load; repo alone can't. When we
        // can load, do so; otherwise fall into browse mode and list recent runs.
        const canLoad = Boolean(
            loadInput && (loadInput.runUrl || (loadInput.repo && loadInput.runId != null)),
        );
        if (canLoad) {
            try {
                await loadRun(instanceId, loadInput, sessionLog);
            } catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                setState(instanceId, {
                    status: "error",
                    message,
                    run: null,
                    updatedAt: Date.now(),
                    picker: currentPicker(instanceId),
                });
            }
        } else {
            try {
                await listRuns(instanceId, { repo: loadInput?.repo }, sessionLog);
            } catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                sessionLog?.(`workflow-viz list error: ${message}`, { level: "warn" });
            }
        }
        const run = getState(instanceId)?.run ?? null;
        return {
            title: run ? `${run.display_title} · ${run.repo}` : "Actions Workflow Run",
            status: run
                ? `${run.status}${run.conclusion ? ` (${run.conclusion})` : ""}`
                : "Waiting for a run",
        };
    },
    onClose: ({ instanceId }) => {
        // The kit tears down the loopback server + SSE subscribers; we only need
        // to stop the poll timer and drop our bookkeeping.
        const poll = polls.get(instanceId);
        if (poll) {
            stopPolling(poll);
            polls.delete(instanceId);
        }
        pickers.delete(instanceId);
    },
});

// Wire the live Copilot session hooks the action handlers call into.
// `bindSession` is invoked by src/extension.ts once joinSession resolves; it is
// simply never called on the dev path, where the handlers tolerate undefined
// hooks (logging/attachments become no-ops in a plain browser).
export function bindSession(log: LogFn, pushAttachments: PushAttachmentsFn): void {
    sessionLog = log;
    sessionPushAttachments = pushAttachments;
}

export { host, canvas };
