// Sidebar/tree data layer: list the workflows in a repo and their recent runs,
// mirroring the GitHub Actions list endpoints (types reused verbatim). This is
// the shallow browse layer that feeds a future in-canvas panel; drilling into a
// single run's job DAG stays in run-data.ts (fetchRunGraph). Nothing here is
// wired to the UI yet.

import { getOctokit } from "./github.js";
import type {
    RunListStatus,
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

// Recent runs for one workflow.
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
