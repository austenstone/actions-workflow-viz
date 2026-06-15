import { AlertIcon, InfoIcon, StopIcon } from "@primer/octicons-react";
import type { ReactNode } from "react";
import type { Annotation, AnnotationLevel, GraphNode, RunGraph } from "../types";
import { runAnnotationCounts } from "../format";

const LEVEL_ICON: Record<AnnotationLevel, ReactNode> = {
    failure: <StopIcon />,
    warning: <AlertIcon />,
    notice: <InfoIcon />,
};

// Run-level annotation summary strip. Mirrors the "Annotations" callouts GitHub
// shows on the run page so warnings/failures are visible without opening a job.
// Clicking a count jumps to the first job carrying that level.
export function AnnotationsBand({
    run,
    onOpenDetail,
}: {
    run: RunGraph;
    onOpenDetail: (node: GraphNode) => void;
}) {
    const counts = runAnnotationCounts(run);
    if (counts.total === 0) return null;

    const firstWith = (level: AnnotationLevel): GraphNode | null =>
        run.nodes.find((n) => n.annotations.some((a: Annotation) => a.level === level)) ?? null;

    const items: { level: AnnotationLevel; n: number; label: string }[] = [
        { level: "failure", n: counts.failure, label: counts.failure === 1 ? "error" : "errors" },
        { level: "warning", n: counts.warning, label: counts.warning === 1 ? "warning" : "warnings" },
        { level: "notice", n: counts.notice, label: counts.notice === 1 ? "notice" : "notices" },
    ].filter((i) => i.n > 0);

    return (
        <div className="ann-band">
            {items.map((i) => {
                const target = firstWith(i.level);
                return (
                    <button
                        key={i.level}
                        type="button"
                        className={"ann-pill l-" + i.level}
                        title={target ? `Jump to ${target.label}` : undefined}
                        onClick={() => target && onOpenDetail(target)}
                    >
                        <span className="ann-ico">{LEVEL_ICON[i.level]}</span>
                        {i.n} {i.label}
                    </button>
                );
            })}
        </div>
    );
}
