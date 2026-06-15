import { motion, useReducedMotion } from "motion/react";
import { EDGE_FADE } from "../anim";

export interface EdgeGeom {
    key: string;
    d: string;
    active: boolean;
}

// SVG dependency edges. Geometry is measured by Graph (it owns the card rects);
// this just renders the paths. A stable `key` keeps the same motion element
// mounted (no re-fade); a new key mounts fresh and fades in via `initial`.
export function Edges({ edges }: { edges: EdgeGeom[] }) {
    const reduce = useReducedMotion();
    return (
        <svg className="edges">
            {edges.map((e) => (
                <motion.path
                    key={e.key}
                    className={"edge" + (e.active ? " active" : "")}
                    d={e.d}
                    initial={reduce ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={EDGE_FADE}
                />
            ))}
        </svg>
    );
}
