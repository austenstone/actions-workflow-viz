// Sidebar/tree data layer: list the workflows in a repo and their recent runs,
// mirroring the GitHub Actions list endpoints (types reused verbatim). This is
// the shallow browse layer that feeds a future in-canvas panel; drilling into a
// single run's job DAG stays in run-data.ts (fetchRunGraph). Nothing here is
// wired to the UI yet.

import { getOctokit } from "./github.js";
import type {
    RunListStatus,
    RunSummary,
    WorkflowDef,
    WorkflowRunData,
    WorkflowsTree,
    WorkflowTreeItem,
} from "./types.js";

export interface RunQuery {
    branch?: string;
    event?: string;
    status?: RunListStatus;
    perPage?: number;
}

const DEFAULT_RUNS_PER_PAGE = 20;

// All workflow definitions in a repo (active and disabled). Paginated.
export async function fetchWorkflows(repo: string): Promise<WorkflowDef[]> {
    const [owner, name] = repo.split("/");
    const octokit = await getOctokit();
    return octokit.paginate(octokit.rest.actions.listRepoWorkflows, {
        owner,
        repo: name,
        per_page: 100,
    });
}

// Recent runs across the whole repo — the "current branch" / activity feed view
// when filtered by branch. Single page (newest first); not paginated since a
// sidebar only ever shows a window.
export async function fetchRepoRuns(repo: string, query: RunQuery = {}): Promise<WorkflowRunData[]> {
    const [owner, name] = repo.split("/");
    const octokit = await getOctokit();
    const { data } = await octokit.rest.actions.listWorkflowRunsForRepo({
        owner,
        repo: name,
        branch: query.branch,
        event: query.event,
        status: query.status,
        per_page: query.perPage ?? DEFAULT_RUNS_PER_PAGE,
    });
    return data.workflow_runs;
}

// Flatten a raw run into the compact row the picker renders. Keeps the Octokit
// payload out of the browser bundle.
export function toRunSummary(run: WorkflowRunData): RunSummary {
    return {
        id: run.id,
        runNumber: run.run_number ?? null,
        name: run.name ?? run.display_title ?? "Workflow run",
        title: run.display_title ?? run.name ?? "",
        status: run.status ?? null,
        conclusion: run.conclusion ?? null,
        branch: run.head_branch ?? null,
        baseBranch: run.pull_requests?.[0]?.base?.ref ?? null,
        headSha: run.head_sha ?? null,
        event: run.event ?? null,
        createdAt: run.created_at ?? null,
        runStartedAt: run.run_started_at ?? null,
        htmlUrl: run.html_url ?? null,
        actor: run.actor
            ? {
                  login: run.actor.login,
                  avatar_url: run.actor.avatar_url ?? null,
                  html_url: run.actor.html_url ?? null,
              }
            : null,
    };
}

// Annotation counts for a run, derived from its check suite. annotations_count
// on each check run is a total; we split warning vs failure by the check run's
// own conclusion (a failed check's annotations are errors, otherwise warnings).
// Cached per completed check suite since those counts never change.
const annCountCache = new Map<number, { warning: number; failure: number }>();
const FAIL_CONCLUSIONS = new Set(["failure", "timed_out", "action_required", "startup_failure"]);

async function fetchRunAnnotationCounts(
    repo: string,
    runs: WorkflowRunData[],
): Promise<Map<number, { warning: number; failure: number }>> {
    const [owner, name] = repo.split("/");
    const octokit = await getOctokit();
    const out = new Map<number, { warning: number; failure: number }>();
    await Promise.all(
        runs.map(async (run) => {
            const suiteId = run.check_suite_id;
            if (suiteId == null) return;
            const done = run.status === "completed";
            if (done && annCountCache.has(suiteId)) {
                out.set(run.id, annCountCache.get(suiteId)!);
                return;
            }
            try {
                const checks = await octokit.paginate(octokit.rest.checks.listForSuite, {
                    owner,
                    repo: name,
                    check_suite_id: suiteId,
                    per_page: 100,
                });
                let warning = 0;
                let failure = 0;
                for (const c of checks) {
                    const n = c.output?.annotations_count ?? 0;
                    if (n === 0) continue;
                    if (c.conclusion && FAIL_CONCLUSIONS.has(c.conclusion)) failure += n;
                    else warning += n;
                }
                const counts = { warning, failure };
                out.set(run.id, counts);
                if (done) annCountCache.set(suiteId, counts);
            } catch {
                // Best-effort enrichment — never fail the list over annotations.
            }
        }),
    );
    return out;
}

// Recent runs as picker rows (newest first).
export async function fetchRunSummaries(
    repo: string,
    query: RunQuery = {},
): Promise<RunSummary[]> {
    const runs = await fetchRepoRuns(repo, query);
    const counts = await fetchRunAnnotationCounts(repo, runs);
    return runs.map((run) => {
        const summary = toRunSummary(run);
        const c = counts.get(run.id);
        if (c && (c.warning > 0 || c.failure > 0)) summary.annotations = c;
        return summary;
    });
}

export async function fetchWorkflowRuns(
    repo: string,
    workflowId: number,
    query: RunQuery = {},
): Promise<WorkflowRunData[]> {
    const [owner, name] = repo.split("/");
    const octokit = await getOctokit();
    const { data } = await octokit.rest.actions.listWorkflowRuns({
        owner,
        repo: name,
        workflow_id: workflowId,
        branch: query.branch,
        event: query.event,
        status: query.status,
        per_page: query.perPage ?? DEFAULT_RUNS_PER_PAGE,
    });
    return data.workflow_runs;
}

// Eager workflows -> runs tree. Convenient but costs 1 + N requests (one per
// workflow), so a real sidebar should lazy-load runs on expand via
// fetchWorkflowRuns instead. Kept for callers that want the whole shape at once.
export async function fetchWorkflowsTree(
    repo: string,
    opts: { runsPerWorkflow?: number; branch?: string } = {},
): Promise<WorkflowsTree> {
    const workflows = await fetchWorkflows(repo);
    const workflowItems: WorkflowTreeItem[] = await Promise.all(
        workflows.map(async (workflow) => ({
            workflow,
            runs: await fetchWorkflowRuns(repo, workflow.id, {
                branch: opts.branch,
                perPage: opts.runsPerWorkflow ?? 10,
            }),
        })),
    );
    return { repo, workflows: workflowItems, fetchedAt: Date.now() };
}
