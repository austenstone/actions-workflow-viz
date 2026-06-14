// Shared shapes for the run graph envelope. The renderer (index.html) reads
// these field names directly, so the names here are load-bearing — keep them in
// sync with the DOM-binding code in index.html.

export type LegStatus = string; // queued | in_progress | completed | waiting | ...
export type Conclusion = string | null; // success | failure | cancelled | skipped | ...

export interface Step {
    name: string;
    status: LegStatus;
    conclusion: Conclusion;
}

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
    runId: number;
    runName: string;
    runNumber: number | null;
    workflowName: string | null;
    status: string; // queued | in_progress | completed
    conclusion: Conclusion;
    event: string | null;
    headBranch: string | null;
    headSha: string | null;
    htmlUrl: string | null;
    runStartedAt: string | null;
    updatedAt: string | null;
    actor: string | null;
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
