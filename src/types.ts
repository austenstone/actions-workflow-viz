// Shared shapes for the run graph envelope. The renderer (index.html) and the
// extension read these field names directly, so they're load-bearing. The
// envelope mirrors the Actions REST API: run/job/step fields are reused verbatim
// from Octokit (snake_case), and only the graph rollup concepts (nodes, edges,
// layered status) are ours.

import type { RestEndpointMethodTypes } from "@octokit/plugin-rest-endpoint-methods";

// Raw Actions API payloads.
export type WorkflowRunData =
    RestEndpointMethodTypes["actions"]["getWorkflowRun"]["response"]["data"];
export type WorkflowJob =
    RestEndpointMethodTypes["actions"]["listJobsForWorkflowRun"]["response"]["data"]["jobs"][number];
export type WorkflowStep = NonNullable<WorkflowJob["steps"]>[number];

// A leg is a live job; a step is one of its steps. Reused as-is from the API.
export type Leg = WorkflowJob;
export type Step = WorkflowStep;
export type Conclusion = WorkflowJob["conclusion"];

// Rolled-up status the renderer colors by (no API equivalent).
export type NodeStatus = "pending" | "queued" | "in_progress" | "completed";

// A DAG node: one workflow job, or a matrix rollup of its legs. Field names
// follow the Actions API casing where they mirror it.
export interface GraphNode {
    id: string;
    label: string;
    status: NodeStatus;
    conclusion: Conclusion;
    legs: Leg[];
    matrix?: boolean;
    unmatched?: boolean;
    started_at: string | null;
    completed_at: string | null;
    html_url: string | null;
}

export interface GraphEdge {
    from: string;
    to: string;
}

// The run envelope: the full Actions run (reused verbatim) plus our graph and
// bookkeeping additions.
export type RunGraph = WorkflowRunData & {
    repo: string;
    nodes: GraphNode[];
    edges: GraphEdge[];
    flat: boolean;
    yamlError: string | null;
    fetchedAt: number;
};

export interface RunRef {
    repo: string;
    runId: number;
}

// Sidebar / tree model: the workflows in a repo, each with its recent runs.
// Mirrors the Actions list endpoints (reused verbatim). This is the shallow
// browse layer; run -> jobs -> steps for a selected run is fetchRunGraph.
export type WorkflowDef =
    RestEndpointMethodTypes["actions"]["listRepoWorkflows"]["response"]["data"]["workflows"][number];

// Status filter accepted by the run list endpoints, reused so callers can't
// pass a value the API rejects.
export type RunListStatus =
    RestEndpointMethodTypes["actions"]["listWorkflowRunsForRepo"]["parameters"]["status"];

export interface WorkflowTreeItem {
    workflow: WorkflowDef;
    runs: WorkflowRunData[];
}

export interface WorkflowsTree {
    repo: string;
    workflows: WorkflowTreeItem[];
    fetchedAt: number;
}

// A compact run row for the empty-state picker. Mapped from WorkflowRunData so
// the browser bundle never sees the raw Octokit payload.
export interface RunSummary {
    id: number;
    runNumber: number | null;
    name: string;
    title: string;
    status: string | null;
    conclusion: string | null;
    branch: string | null;
    baseBranch: string | null;
    headSha: string | null;
    event: string | null;
    createdAt: string | null;
    runStartedAt: string | null;
    htmlUrl: string | null;
    actor: { login: string; avatar_url: string | null; html_url: string | null } | null;
}

// Browse-mode model: the recent runs to pick from when no run is loaded.
export interface RunPicker {
    repo: string | null;
    runs: RunSummary[];
    loading: boolean;
    error: string | null;
}

export type CanvasStatus = "idle" | "loading" | "ok" | "error";

export interface CanvasState {
    status: CanvasStatus;
    message: string | null;
    run: RunGraph | null;
    updatedAt: number | null;
    picker?: RunPicker | null;
}
