// Pure DAG layout: top-down longest-path layering plus a median-heuristic
// crossing-minimization sweep. Lifted verbatim from the old index.html renderer
// (only typed and modularized) so the produced ordering is byte-for-byte the
// same. Kept side-effect free so it's unit-testable and cheap to memoize.
import type { GraphNode, RunGraph } from "./types";

export interface LayeredGraph {
    stages: GraphNode[][];
    layer: Map<string, number>;
}

export function computeLayers(run: RunGraph): LayeredGraph {
    const nodes = run.nodes;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const preds = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
    const succ = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
    for (const e of run.edges) {
        if (byId.has(e.from) && byId.has(e.to)) {
            preds.get(e.to)!.push(e.from);
            succ.get(e.from)!.push(e.to);
        }
    }
    const layer = new Map<string, number>();
    function depth(id: string, seen: Set<string>): number {
        if (layer.has(id)) return layer.get(id)!;
        if (seen.has(id)) return 0;
        seen.add(id);
        const ps = preds.get(id) || [];
        let d = 0;
        for (const p of ps) d = Math.max(d, depth(p, seen) + 1);
        layer.set(id, d);
        return d;
    }
    for (const n of nodes) depth(n.id, new Set());
    const maxLayer = Math.max(0, ...nodes.map((n) => layer.get(n.id) || 0));
    const stages: GraphNode[][] = Array.from({ length: maxLayer + 1 }, () => []);
    for (const n of nodes) stages[layer.get(n.id) || 0].push(n);
    const idx = new Map(nodes.map((n, i) => [n.id, i]));
    orderStages(stages, preds, succ, idx);
    return { stages, layer };
}

function orderStages(
    stages: GraphNode[][],
    preds: Map<string, string[]>,
    succ: Map<string, string[]>,
    idx: Map<string, number>,
): void {
    if (stages.length < 2) return;
    const median = (positions: number[]): number => {
        if (positions.length === 0) return -1;
        const s = positions.slice().sort((a, b) => a - b);
        const m = Math.floor(s.length / 2);
        return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };
    const posOf = (stage: GraphNode[]): Map<string, number> => {
        const p = new Map<string, number>();
        stage.forEach((n, i) => p.set(n.id, i));
        return p;
    };
    const countCrossings = (): number => {
        let total = 0;
        for (let i = 0; i < stages.length - 1; i++) {
            const pos = posOf(stages[i + 1]);
            const topPos = posOf(stages[i]);
            const segs: [number, number][] = [];
            for (const n of stages[i]) {
                const tops = topPos.get(n.id)!;
                for (const t of succ.get(n.id) || []) {
                    if (pos.has(t)) segs.push([tops, pos.get(t)!]);
                }
            }
            for (let a = 0; a < segs.length; a++) {
                for (let b = a + 1; b < segs.length; b++) {
                    const [u1, v1] = segs[a];
                    const [u2, v2] = segs[b];
                    if ((u1 < u2 && v1 > v2) || (u1 > u2 && v1 < v2)) total++;
                }
            }
        }
        return total;
    };
    const orderBy =
        (neighbors: Map<string, string[]>, refStage: GraphNode[]) =>
        (stage: GraphNode[]): GraphNode[] => {
            const refPos = posOf(refStage);
            const keyed = stage.map((n) => {
                const ns = (neighbors.get(n.id) || [])
                    .map((m) => refPos.get(m))
                    .filter((v): v is number => v !== undefined);
                return { n, med: median(ns) };
            });
            const movable = keyed.filter((k) => k.med >= 0);
            movable.sort((a, b) => a.med - b.med || idx.get(a.n.id)! - idx.get(b.n.id)!);
            let mi = 0;
            return keyed.map((k) => (k.med < 0 ? k.n : movable[mi++].n));
        };
    const snapshot = (): GraphNode[][] => stages.map((s) => s.slice());
    const restore = (snap: GraphNode[][]): void => {
        snap.forEach((s, i) => (stages[i] = s.slice()));
    };
    let best = snapshot();
    let bestCross = countCrossings();
    for (let sweep = 0; sweep < 4; sweep++) {
        if (sweep % 2 === 0) {
            for (let i = 1; i < stages.length; i++) {
                stages[i] = orderBy(preds, stages[i - 1])(stages[i]);
            }
        } else {
            for (let i = stages.length - 2; i >= 0; i--) {
                stages[i] = orderBy(succ, stages[i + 1])(stages[i]);
            }
        }
        const c = countCrossings();
        if (c < bestCross) {
            bestCross = c;
            best = snapshot();
        }
    }
    restore(best);
}

// The renderer groups nodes into stages; a flat run (no edges or YAML parse
// failure) collapses to a single row.
export function stagesFor(run: RunGraph): GraphNode[][] {
    if (run.flat || run.edges.length === 0) return [run.nodes];
    return computeLayers(run).stages;
}
