import { useLayoutEffect, useRef } from "react";
import { enterEdge } from "../anim";

export interface EdgeGeom {
    key: string;
    d: string;
    active: boolean;
}

// SVG dependency edges. Geometry is measured by Graph (it owns the card rects);
// this just renders the paths and fades in any that are new this commit.
export function Edges({ edges }: { edges: EdgeGeom[] }) {
    const paths = useRef<Map<string, SVGPathElement>>(new Map());
    const prevKeys = useRef<Set<string>>(new Set());

    useLayoutEffect(() => {
        for (const e of edges) {
            if (!prevKeys.current.has(e.key)) {
                const el = paths.current.get(e.key);
                if (el) enterEdge(el);
            }
        }
        prevKeys.current = new Set(edges.map((e) => e.key));
    }, [edges]);

    return (
        <svg className="edges">
            {edges.map((e) => (
                <path
                    key={e.key}
                    ref={(el) => {
                        if (el) paths.current.set(e.key, el);
                        else paths.current.delete(e.key);
                    }}
                    className={"edge" + (e.active ? " active" : "")}
                    d={e.d}
                />
            ))}
        </svg>
    );
}
