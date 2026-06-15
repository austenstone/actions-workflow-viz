import { describe, expect, it } from "vitest";

import { buildGraph } from "./run-data.js";
import type { JobDef, ParsedJobs } from "./parse-needs.js";
import type { GraphNode } from "./types.js";

import type { RestEndpointMethodTypes } from "@octokit/plugin-rest-endpoint-methods";

type LiveJob =
    RestEndpointMethodTypes["actions"]["listJobsForWorkflowRun"]["response"]["data"]["jobs"][number];

let nextJobId = 1;

// Minimal LiveJob factory: spreads sane defaults and casts once so test bodies
// stay free of `as` noise. Only the fields buildGraph/legOf read are populated.
function job(overrides: Partial<LiveJob> & { name: string }): LiveJob {
    const base = {
        id: nextJobId++,
        name: overrides.name,
        status: "completed",
        conclusion: "success",
        started_at: null,
        completed_at: null,
        html_url: `https://example.test/job/${overrides.name}`,
        steps: [],
    };
    return { ...base, ...overrides } as unknown as LiveJob;
}

function def(id: string, overrides: Partial<JobDef> = {}): JobDef {
    return { id, name: null, needs: [], matrix: false, ...overrides };
}

function parsed(defs: JobDef[]): ParsedJobs {
    const jobs: Record<string, JobDef> = {};
    for (const d of defs) jobs[d.id] = d;
    return { jobs, order: defs.map((d) => d.id) };
}

const nodeById = (nodes: GraphNode[], id: string) => nodes.find((n) => n.id === id);

describe("buildGraph flat fallback", () => {
    it("renders one rootless node per live job and no edges when there is no YAML structure", () => {
        const live = [job({ name: "build" }), job({ name: "test" })];

        const { nodes, edges, flat } = buildGraph(parsed([]), live);

        expect(flat).toBe(true);
        expect(edges).toEqual([]);
        expect(nodes).toHaveLength(2);
        expect(nodes.map((n) => n.id)).toEqual(live.map((j) => String(j.id)));
        expect(nodes[0].label).toBe("build");
        expect(nodes[0].legs).toHaveLength(1);
    });
});

describe("buildGraph plain (no matrix) DAG", () => {
    it("matches live jobs by id and emits needs edges", () => {
        const p = parsed([def("build"), def("test", { needs: ["build"] })]);
        const live = [job({ name: "build" }), job({ name: "test" })];

        const { nodes, edges, flat } = buildGraph(p, live);

        expect(flat).toBe(false);
        expect(nodes.map((n) => n.id)).toEqual(["build", "test"]);
        expect(nodeById(nodes, "build")!.legs).toHaveLength(1);
        expect(nodeById(nodes, "test")!.legs).toHaveLength(1);
        expect(edges).toEqual([{ from: "build", to: "test" }]);
    });

    it("matches by explicit display name and uses it as the label", () => {
        const p = parsed([def("build", { name: "Build app" })]);
        const live = [job({ name: "Build app" })];

        const { nodes } = buildGraph(p, live);

        expect(nodeById(nodes, "build")!.legs).toHaveLength(1);
        expect(nodeById(nodes, "build")!.label).toBe("Build app");
    });

    it("matches matrix legs by their base (suffix-stripped) name", () => {
        const p = parsed([def("test", { name: "test", matrix: true })]);
        const live = [
            job({ name: "test (ubuntu-latest, 18)" }),
            job({ name: "test (ubuntu-latest, 20)" }),
        ];

        const { nodes } = buildGraph(p, live);

        const node = nodeById(nodes, "test")!;
        expect(node.legs).toHaveLength(2);
        expect(node.matrix).toBe(true);
        expect(node.unmatched).toBeUndefined();
    });

    it("drops edges whose dependency has no node", () => {
        const p = parsed([def("test", { needs: ["ghost"] })]);
        const live = [job({ name: "test" })];

        const { edges } = buildGraph(p, live);

        expect(edges).toEqual([]);
    });
});

describe("buildGraph heuristic (a): single empty dynamic matrix", () => {
    it("folds expression-named orphan legs into the only empty matrix job, even when a downstream job is also pending", () => {
        // `test` is a dynamic matrix (expression name, no live leg matches its id
        // or template). `report` is a plain downstream job that merely hasn't
        // started — it must NOT absorb the matrix legs.
        const p = parsed([
            def("lint"),
            def("test", { name: "${{ matrix.model }}", needs: ["lint"], matrix: true }),
            def("report", { needs: ["test"] }),
        ]);
        const live = [
            job({ name: "lint" }),
            job({ name: "claude-opus" }),
            job({ name: "gpt-5" }),
        ];

        const { nodes, edges } = buildGraph(p, live);

        const test = nodeById(nodes, "test")!;
        expect(test.legs).toHaveLength(2);
        expect(test.matrix).toBe(true);
        // Expression name is useless as a title, so it falls back to the job id.
        expect(test.label).toBe("test");

        const report = nodeById(nodes, "report")!;
        expect(report.legs).toHaveLength(0);
        expect(report.status).toBe("pending");

        // No orphan rootless nodes were created.
        expect(nodes.some((n) => n.unmatched)).toBe(false);
        expect(nodes.some((n) => n.id.startsWith("__live_"))).toBe(false);

        expect(edges).toContainEqual({ from: "lint", to: "test" });
        expect(edges).toContainEqual({ from: "test", to: "report" });
    });
});

describe("buildGraph heuristic (b): multiple dynamic matrices by name prefix", () => {
    it("assigns each orphan leg to the matrix whose static prefix it matches and leaves ambiguous legs rootless", () => {
        const p = parsed([
            def("bench", { name: "bench-${{ matrix.x }}", matrix: true }),
            def("lint", { name: "lint-${{ matrix.y }}", matrix: true }),
        ]);
        const live = [
            job({ name: "bench-a" }),
            job({ name: "bench-b" }),
            job({ name: "lint-x" }),
            job({ name: "weird-1" }),
        ];

        const { nodes } = buildGraph(p, live);

        expect(nodeById(nodes, "bench")!.legs).toHaveLength(2);
        expect(nodeById(nodes, "lint")!.legs).toHaveLength(1);

        const orphans = nodes.filter((n) => n.unmatched);
        expect(orphans).toHaveLength(1);
        expect(orphans[0].label).toBe("weird-1");
        expect(orphans[0].id).toMatch(/^__live_/);
    });
});

describe("buildGraph heuristic (c): single empty non-matrix fallback", () => {
    it("folds orphans into the lone empty job when no matrix job is available to claim them", () => {
        const p = parsed([def("build"), def("deploy", { needs: ["build"] })]);
        const live = [
            job({ name: "build" }),
            job({ name: "shard-1" }),
            job({ name: "shard-2" }),
        ];

        const { nodes } = buildGraph(p, live);

        const deploy = nodeById(nodes, "deploy")!;
        expect(deploy.legs).toHaveLength(2);
        // Two folded legs flip the matrix flag on even though the YAML didn't.
        expect(deploy.matrix).toBe(true);
        expect(nodes.some((n) => n.unmatched)).toBe(false);
    });
});

describe("buildGraph no-fold scatter path", () => {
    it("leaves orphans as rootless nodes when several non-matrix jobs are empty", () => {
        const p = parsed([def("build"), def("deploy"), def("notify")]);
        const live = [job({ name: "build" }), job({ name: "x-1" })];

        const { nodes } = buildGraph(p, live);

        expect(nodeById(nodes, "deploy")!.legs).toHaveLength(0);
        expect(nodeById(nodes, "notify")!.legs).toHaveLength(0);

        const orphans = nodes.filter((n) => n.unmatched);
        expect(orphans).toHaveLength(1);
        expect(orphans[0].label).toBe("x-1");
    });
});

describe("buildGraph status rollup", () => {
    it("reports in_progress when any leg is running", () => {
        const p = parsed([def("test", { matrix: true })]);
        const live = [
            job({ name: "test (1)", status: "completed", conclusion: "success" }),
            job({ name: "test (2)", status: "in_progress", conclusion: null }),
        ];

        const { nodes } = buildGraph(p, live);

        expect(nodeById(nodes, "test")!.status).toBe("in_progress");
    });

    it("rolls completed legs up to the worst conclusion", () => {
        const p = parsed([def("test", { matrix: true })]);
        const live = [
            job({ name: "test (1)", status: "completed", conclusion: "success" }),
            job({ name: "test (2)", status: "completed", conclusion: "failure" }),
        ];

        const { nodes } = buildGraph(p, live);

        const node = nodeById(nodes, "test")!;
        expect(node.status).toBe("completed");
        expect(node.conclusion).toBe("failure");
    });

    it("derives node start/end from the spread of its legs", () => {
        const p = parsed([def("test", { matrix: true })]);
        const live = [
            job({
                name: "test (1)",
                started_at: "2024-01-01T00:00:05Z",
                completed_at: "2024-01-01T00:01:00Z",
            }),
            job({
                name: "test (2)",
                started_at: "2024-01-01T00:00:01Z",
                completed_at: "2024-01-01T00:02:00Z",
            }),
        ];

        const { nodes } = buildGraph(p, live);

        const node = nodeById(nodes, "test")!;
        expect(node.startedAt).toBe("2024-01-01T00:00:01Z");
        expect(node.completedAt).toBe("2024-01-01T00:02:00Z");
    });
});
