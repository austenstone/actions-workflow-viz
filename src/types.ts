// Shared shapes for the run graph envelope. The renderer (index.html) reads
// these field names directly, so the names here are load-bearing — keep them in
// sync with the DOM-binding code in index.html.
//
// The raw Actions API payloads and their lifecycle enums are reused straight
// from Octokit's REST typings rather than redeclared, so they track the API.

import type { RestEndpointMethodTypes } from "@octokit/plugin-rest-endpoint-methods";

// Raw Actions API payloads.
export type WorkflowRunData =
    RestEndpointMethodTypes["actions"]["getWorkflowRun"]["response"]["data"];
export type WorkflowJob =
    RestEndpointMethodTypes["actions"]["listJobsForWorkflowRun"]["response"]["data"]["jobs"][number];
export type WorkflowStep = NonNullable<WorkflowJob["steps"]>[number];

// Job-level lifecycle enums, reused from the job schema (strict unions). Note
// the run schema types its own status/conclusion loosely (`string | null`), so
// run-level fields below intentionally don't reuse these.
export type LegStatus = WorkflowJob["status"];
export type Conclusion = WorkflowJob["conclusion"];

export type Step = Pick<WorkflowStep, "name" | "status" | "conclusion">;

export interface Leg {
    name: string;
    status: LegStatus;
    conclusion: Conclusion;
    startedAt: string | null;
    completedAt: string | null;
    url: string | null;
    steps: Step[];
}

// Rolled-up status the renderer colors by.
export type NodeStatus = "pending" | "queued" | "in_progress" | "completed";

export interface GraphNode {
    id: string;
    label: string;
    status: NodeStatus;
    conclusion: Conclusion;
    legs: Leg[];
    matrix?: boolean;
    unmatched?: boolean;
    startedAt: string | null;
    completedAt: string | null;
    url: string | null;
}

export interface GraphEdge {
    from: string;
    to: string;
}

export interface RunGraph {
    repo: string;
    runId: WorkflowRunData["id"];
    runName: string;
    runNumber: WorkflowRunData["run_number"];
    workflowName: WorkflowRunData["name"];
    status: WorkflowRunData["status"];
    conclusion: WorkflowRunData["conclusion"];
    event: WorkflowRunData["event"];
    headBranch: WorkflowRunData["head_branch"];
    headSha: string | null; // computed: short SHA
    htmlUrl: WorkflowRunData["html_url"];
    runStartedAt: WorkflowRunData["run_started_at"];
    updatedAt: WorkflowRunData["updated_at"];
    actor: string | null; // computed: actor.login
    nodes: GraphNode[];
    edges: GraphEdge[];
    flat: boolean;
    yamlError: string | null;
    fetchedAt: number;
}

export interface RunRef {
    repo: string;
    runId: number;
}

export type CanvasStatus = "idle" | "loading" | "ok" | "error";

export interface CanvasState {
    status: CanvasStatus;
    message: string | null;
    run: RunGraph | null;
    updatedAt: number | null;
}
