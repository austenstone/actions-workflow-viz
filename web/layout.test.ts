import { describe, expect, it } from "vitest";
import { computeLayers, stagesFor } from "./layout";
import type { GraphEdge, GraphNode, RunGraph } from "./types";

function node(id: string): GraphNode {
    return {
        id,
        label: id,
        status: "completed",
        conclusion: "success",
        legs: [],
        started_at: null,
        completed_at: null,
        html_url: null,
    };
}

function run(nodes: GraphNode[], edges: GraphEdge[], flat = false): RunGraph {
    return {
        repo: "o/r",
        nodes,
        edges,
        flat,
        yamlError: null,
        fetchedAt: 0,
    } as unknown as RunGraph;
}

describe("computeLayers", () => {
    it("layers a linear chain a→b→c into three stages", () => {
        const r = run(
            [node("a"), node("b"), node("c")],
            [
                { from: "a", to: "b" },
                { from: "b", to: "c" },
            ],
        );
        const { stages, layer } = computeLayers(r);
        expect(stages.map((s) => s.map((n) => n.id))).toEqual([["a"], ["b"], ["c"]]);
        expect(layer.get("a")).toBe(0);
        expect(layer.get("b")).toBe(1);
        expect(layer.get("c")).toBe(2);
    });

    it("places independent roots on the same first stage", () => {
        const r = run(
            [node("a"), node("b"), node("c")],
            [
                { from: "a", to: "c" },
                { from: "b", to: "c" },
            ],
        );
        const { stages } = computeLayers(r);
        expect(stages.length).toBe(2);
        expect(stages[0].map((n) => n.id).sort()).toEqual(["a", "b"]);
        expect(stages[1].map((n) => n.id)).toEqual(["c"]);
    });

    it("uses longest-path depth for diamonds", () => {
        const r = run(
            [node("a"), node("b"), node("c"), node("d")],
            [
                { from: "a", to: "b" },
                { from: "a", to: "c" },
                { from: "b", to: "d" },
                { from: "c", to: "d" },
            ],
        );
        const { layer } = computeLayers(r);
        expect(layer.get("a")).toBe(0);
        expect(layer.get("b")).toBe(1);
        expect(layer.get("c")).toBe(1);
        expect(layer.get("d")).toBe(2);
    });
});

describe("stagesFor", () => {
    it("collapses a flat run into a single row", () => {
        const nodes = [node("a"), node("b")];
        const r = run(nodes, [{ from: "a", to: "b" }], true);
        expect(stagesFor(r)).toEqual([nodes]);
    });

    it("collapses an edgeless run into a single row", () => {
        const nodes = [node("a"), node("b")];
        const r = run(nodes, []);
        expect(stagesFor(r)).toEqual([nodes]);
    });

    it("delegates to computeLayers when edges exist", () => {
        const r = run(
            [node("a"), node("b")],
            [{ from: "a", to: "b" }],
        );
        expect(stagesFor(r).map((s) => s.map((n) => n.id))).toEqual([["a"], ["b"]]);
    });
});
