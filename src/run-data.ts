// Live GitHub Actions run data via Octokit. Fetch the run + its jobs from the
// Actions API, fetch the workflow YAML at the run's commit, and fold them into a
// job-dependency DAG annotated with live status. The output envelope is consumed
// directly by index.html, so its shape is load-bearing — keep field names stable.

import { getOctokit } from "./github.js";
import { parseJobsNeeds, type ParsedJobs } from "./parse-needs.js";
import type {
    Conclusion,
    GraphEdge,
    GraphNode,
    Leg,
    NodeStatus,
    RunGraph,
    RunRef,
    WorkflowJob,
} from "./types.js";

// The Actions jobs API payload, derived straight from Octokit's typings rather
// than redeclared by hand.
type LiveJob = WorkflowJob;

// Accepts "owner/repo" + run id, or a full run URL like
// https://github.com/owner/repo/actions/runs/123456789
export function parseRunRef({
    repo,
    runId,
    runUrl,
}: {
    repo?: string;
    runId?: number | string;
    runUrl?: string;
}): RunRef {
    if (runUrl) {
        const m = String(runUrl).match(/github\.com\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)/);
        if (m) return { repo: m[1], runId: Number(m[2]) };
    }
    if (repo && runId != null) {
        return { repo: String(repo), runId: Number(runId) };
    }
    throw new Error("Provide either { repo, runId } or a { runUrl }.");
}

// Normalize the GitHub job status/conclusion into a small status set the
// renderer colors by.
function nodeStatusFromLegs(legs: Array<Pick<LiveJob, "status" | "conclusion">>): {
    status: NodeStatus;
    conclusion: Conclusion;
} {
    if (legs.length === 0) return { status: "pending", conclusion: null };

    if (legs.some((l) => l.status === "in_progress")) {
        return { status: "in_progress", conclusion: null };
    }
    if (
        legs.some(
            (l) =>
                l.status === "queued" ||
                l.status === "waiting" ||
                l.status === "requested" ||
                l.status === "pending",
        )
    ) {
        return { status: "queued", conclusion: null };
    }
    // All completed → roll up the worst conclusion.
    const order: Conclusion[] = ["failure", "timed_out", "cancelled", "action_required", "neutral", "success", "skipped"];
    let worst: Conclusion = "skipped";
    for (const l of legs) {
        const c: Conclusion = l.conclusion || "success";
        if (order.indexOf(c) < order.indexOf(worst)) worst = c;
    }
    return { status: "completed", conclusion: worst };
}

function baseName(jobName: string): string {
    // Matrix legs look like "build (ubuntu-latest, 18)" — strip the suffix to
    // recover the base job display name.
    return jobName.replace(/\s*\(.*\)\s*$/, "").trim();
}

function namePrefix(name: string | null): string | null {
    // Static text before the first `${{` in a matrix job's name template, used
    // to attribute expression-named legs (e.g. `name: bench-${{ matrix.x }}`
    // → "bench-"). Returns null when there's no usable static prefix.
    if (!name) return null;
    const i = name.indexOf("${{");
    if (i <= 0) return null;
    const prefix = name.slice(0, i).trim();
    return prefix || null;
}

// Workflow YAML is immutable per commit, so its parsed jobs/needs structure is
// cached across polls keyed by repo+path+sha. Bounded to avoid unbounded growth.
const yamlCache = new Map<string, ParsedJobs>();
const YAML_CACHE_MAX = 64;
function cacheYaml(key: string, value: ParsedJobs): void {
    if (yamlCache.size >= YAML_CACHE_MAX) {
        const oldest = yamlCache.keys().next().value;
        if (oldest !== undefined) yamlCache.delete(oldest);
    }
    yamlCache.set(key, value);
}

export async function fetchRunGraph({ repo, runId }: RunRef): Promise<RunGraph> {
    const [owner, name] = repo.split("/");
    const octokit = await getOctokit();

    const { data: run } = await octokit.rest.actions.getWorkflowRun({
        owner,
        repo: name,
        run_id: runId,
    });

    const liveJobs = (await octokit.paginate(octokit.rest.actions.listJobsForWorkflowRun, {
        owner,
        repo: name,
        run_id: runId,
        per_page: 100,
    })) as unknown as LiveJob[];

    // Recover the dependency structure from the workflow YAML at the run's
    // commit. The YAML is immutable for a given commit, so cache the parse by
    // repo+path+sha — repeat polls then cost 2 API calls instead of 3. Any
    // failure here falls back to a flat board.
    let parsed: ParsedJobs = { jobs: {}, order: [] };
    let yamlError: string | null = null;
    if (run.path && run.head_sha) {
        const cacheKey = `${repo}:${run.path}@${run.head_sha}`;
        const cached = yamlCache.get(cacheKey);
        if (cached) {
            parsed = cached;
        } else {
            try {
                const res = await octokit.rest.repos.getContent({
                    owner,
                    repo: name,
                    path: run.path,
                    ref: run.head_sha,
                    mediaType: { format: "raw" },
                });
                const yaml = res.data as unknown as string;
                parsed = await parseJobsNeeds(yaml);
                cacheYaml(cacheKey, parsed);
            } catch (e) {
                yamlError = e instanceof Error ? e.message : String(e);
            }
        }
    }

    const graph = buildGraph(parsed, liveJobs);

    return {
        ...run,
        repo,
        nodes: graph.nodes,
        edges: graph.edges,
        flat: graph.flat,
        yamlError,
        fetchedAt: Date.now(),
    };
}

export function buildGraph(
    parsed: ParsedJobs,
    liveJobs: LiveJob[],
): { nodes: GraphNode[]; edges: GraphEdge[]; flat: boolean } {
    const jobIds = parsed.order;
    const hasStructure = jobIds.length > 0;

    if (!hasStructure) {
        // Flat board: one node per live job, no edges.
        const nodes: GraphNode[] = liveJobs.map((j) => {
            const { status, conclusion } = nodeStatusFromLegs([j]);
            return {
                id: String(j.id),
                label: j.name,
                status,
                conclusion,
                legs: [j],
                started_at: j.started_at,
                completed_at: j.completed_at,
                html_url: j.html_url,
            };
        });
        return { nodes, edges: [], flat: true };
    }

    // Map each YAML job id to its live legs. Match a live job to a base job by
    // exact name, by base (matrix-stripped) name, or by the raw job id.
    const displayToId = new Map<string, string>();
    for (const id of jobIds) {
        const def = parsed.jobs[id];
        displayToId.set(id, id);
        if (def.name) displayToId.set(def.name, id);
    }

    const legsById = new Map<string, Leg[]>(jobIds.map((id) => [id, []]));
    const unmatched: LiveJob[] = [];
    for (const j of liveJobs) {
        const candidates = [j.name, baseName(j.name)];
        let target: string | null = null;
        for (const c of candidates) {
            if (displayToId.has(c)) {
                target = displayToId.get(c)!;
                break;
            }
        }
        if (target) legsById.get(target)!.push(j);
        else unmatched.push(j);
    }

    // Fold any orphan live jobs (expression-named matrix legs that didn't match
    // a job id or name) into their parent matrix job. A dynamic matrix's legs
    // appear late and carry resolved names like "claude-opus-4.7" that match
    // nothing — without this they'd scatter as rootless, edgeless nodes.
    //
    // Only EMPTY MATRIX jobs are claim candidates; a plain downstream job that
    // merely hasn't started yet must not absorb matrix legs (that was the old
    // single-empty-job bug — it failed whenever a matrix coexisted with a
    // pending downstream job).
    const emptyJobIds = jobIds.filter((id) => legsById.get(id)!.length === 0);
    const emptyMatrixJobs = emptyJobIds.filter((id) => parsed.jobs[id].matrix);
    if (unmatched.length > 0) {
        if (emptyMatrixJobs.length === 1) {
            const target = emptyMatrixJobs[0];
            for (const j of unmatched) legsById.get(target)!.push(j);
            unmatched.length = 0;
        } else if (emptyMatrixJobs.length > 1) {
            // Multiple dynamic matrices: assign each leg to the matrix job whose
            // static name prefix it matches (e.g. `name: bench-${{...}}` →
            // "bench-"). Anything ambiguous stays a rootless node.
            const prefixed = emptyMatrixJobs
                .map((id) => ({ id, prefix: namePrefix(parsed.jobs[id].name) }))
                .filter((p): p is { id: string; prefix: string } => Boolean(p.prefix));
            const leftover: LiveJob[] = [];
            for (const j of unmatched) {
                const hits = prefixed.filter((p) => j.name.startsWith(p.prefix));
                if (hits.length === 1) legsById.get(hits[0].id)!.push(j);
                else leftover.push(j);
            }
            unmatched.length = 0;
            unmatched.push(...leftover);
        } else if (emptyJobIds.length === 1) {
            // Fallback: exactly one empty (non-matrix) job and we have orphans —
            // preserve the original heuristic so YAML the parser couldn't flag as
            // a matrix still folds rather than scattering.
            const target = emptyJobIds[0];
            for (const j of unmatched) legsById.get(target)!.push(j);
            unmatched.length = 0;
        }
    }

    const nodes: GraphNode[] = jobIds.map((id) => {
        const def = parsed.jobs[id];
        const legs = legsById.get(id)!;
        const { status, conclusion } = nodeStatusFromLegs(legs);
        // Expression-valued `name:` (e.g. "${{ matrix.model }}") is useless as a
        // node title — fall back to the job id.
        const label = def.name && !def.name.includes("${{") ? def.name : id;
        return {
            id,
            label,
            status,
            conclusion,
            legs,
            matrix: parsed.jobs[id].matrix || legs.length > 1,
            started_at: minDate(legs.map((l) => l.started_at)),
            completed_at: maxDate(legs.map((l) => l.completed_at)),
            html_url: legs[0]?.html_url || null,
        };
    });

    // Any live job we couldn't map (e.g. expression-valued names) becomes its
    // own rootless node so nothing is silently dropped.
    for (const j of unmatched) {
        const { status, conclusion } = nodeStatusFromLegs([j]);
        nodes.push({
            id: `__live_${j.id}`,
            label: j.name,
            status,
            conclusion,
            legs: [j],
            unmatched: true,
            started_at: j.started_at,
            completed_at: j.completed_at,
            html_url: j.html_url,
        });
    }

    const nodeIds = new Set(nodes.map((n) => n.id));
    const edges: GraphEdge[] = [];
    for (const id of jobIds) {
        for (const dep of parsed.jobs[id].needs) {
            if (nodeIds.has(dep)) edges.push({ from: dep, to: id });
        }
    }

    return { nodes, edges, flat: false };
}

// --- Mutations ------------------------------------------------------------
//
// Thin wrappers over the Actions write endpoints. Each translates the common
// HTTP failures into a friendly message the canvas can surface verbatim.

function mutationError(action: string, e: unknown): Error {
    const status = (e as { status?: number })?.status;
    if (status === 403) {
        return new Error(`${action} failed: token is missing the \`workflow\` scope.`);
    }
    if (status === 409) {
        return new Error(`${action} failed: the run is not in a re-runnable/cancellable state.`);
    }
    const message = e instanceof Error ? e.message : String(e);
    return new Error(`${action} failed: ${message}`);
}

export async function reRunAllJobs({ repo, runId }: RunRef): Promise<void> {
    const [owner, name] = repo.split("/");
    const octokit = await getOctokit();
    try {
        await octokit.rest.actions.reRunWorkflow({ owner, repo: name, run_id: runId });
    } catch (e) {
        throw mutationError("Re-run all jobs", e);
    }
}

export async function reRunFailedJobs({ repo, runId }: RunRef): Promise<void> {
    const [owner, name] = repo.split("/");
    const octokit = await getOctokit();
    try {
        await octokit.rest.actions.reRunWorkflowFailedJobs({ owner, repo: name, run_id: runId });
    } catch (e) {
        throw mutationError("Re-run failed jobs", e);
    }
}

export async function cancelRun({ repo, runId }: RunRef): Promise<void> {
    const [owner, name] = repo.split("/");
    const octokit = await getOctokit();
    try {
        await octokit.rest.actions.cancelWorkflowRun({ owner, repo: name, run_id: runId });
    } catch (e) {
        throw mutationError("Cancel run", e);
    }
}

export async function reRunJob(repo: string, jobId: number): Promise<void> {
    const [owner, name] = repo.split("/");
    const octokit = await getOctokit();
    try {
        await octokit.rest.actions.reRunJobForWorkflowRun({ owner, repo: name, job_id: jobId });
    } catch (e) {
        throw mutationError("Re-run job", e);
    }
}

function minDate(dates: Array<string | null>): string | null {
    const valid = dates.filter((d): d is string => Boolean(d)).sort();
    return valid[0] || null;
}

function maxDate(dates: Array<string | null>): string | null {
    const valid = dates.filter((d): d is string => Boolean(d)).sort();
    return valid[valid.length - 1] || null;
}
