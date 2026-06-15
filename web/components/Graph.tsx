import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { GraphNode, RunGraph } from "../types";
import { stagesFor } from "../layout";
import { useResizeTick } from "../hooks";
import { JobCard } from "./JobCard";
import { Edges, type EdgeGeom } from "./Edges";

// The scrollable graph: layered stages of JobCards plus measured SVG edges.
// Cards register their DOM nodes into a map; edge geometry is recomputed in a
// layout effect keyed on the run envelope (which changes every poll) and on a
// ResizeObserver tick — deliberately NOT on `now`, so the per-second duration
// tick never triggers an edge remeasure.
export function Graph({
    run,
    now,
    onOpenDetail,
}: {
    run: RunGraph;
    now: number;
    onOpenDetail: (node: GraphNode) => void;
}) {
    const contentRef = useRef<HTMLDivElement>(null);
    const cardMap = useRef<Map<string, HTMLElement>>(new Map());
    const resizeTick = useResizeTick(contentRef);
    const [edges, setEdges] = useState<EdgeGeom[]>([]);

    const runCompleted = run.status === "completed";
    const stages = useMemo(() => stagesFor(run), [run]);

    const registerCard = useCallback((id: string, el: HTMLElement | null) => {
        if (el) cardMap.current.set(id, el);
        else cardMap.current.delete(id);
    }, []);

    useLayoutEffect(() => {
        const content = contentRef.current;
        if (!content) return;
        if (run.flat || run.edges.length === 0) {
            setEdges([]);
            return;
        }
        const cRect = content.getBoundingClientRect();
        const byId = new Map(run.nodes.map((n) => [n.id, n]));
        const next: EdgeGeom[] = [];
        for (const e of run.edges) {
            const from = cardMap.current.get(e.from);
            const to = cardMap.current.get(e.to);
            if (!from || !to) continue;
            const fr = from.getBoundingClientRect();
            const tr = to.getBoundingClientRect();
            const x1 = fr.left - cRect.left + fr.width / 2;
            const y1 = fr.top - cRect.top + fr.height;
            const x2 = tr.left - cRect.left + tr.width / 2;
            const y2 = tr.top - cRect.top;
            const dy = Math.max(18, (y2 - y1) / 2);
            const d = `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
            const pn = byId.get(e.from);
            const cn = byId.get(e.to);
            const active =
                !!pn &&
                (pn.status === "in_progress" ||
                    (pn.status === "completed" && !!cn && cn.status === "in_progress"));
            next.push({ key: e.from + "->" + e.to, d, active });
        }
        setEdges(next);
    }, [run, resizeTick]);

    let cardIndex = 0;
    return (
        <div className="scroll">
            <div className="content" ref={contentRef}>
                <Edges edges={edges} />
                <div className="stages">
                    {stages.map((stage, i) => (
                        <div className="stage" key={i}>
                            {stage.map((node) => (
                                <JobCard
                                    key={node.id}
                                    node={node}
                                    index={cardIndex++}
                                    now={now}
                                    runCompleted={runCompleted}
                                    registerCard={registerCard}
                                    onOpenDetail={onOpenDetail}
                                />
                            ))}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
