import { useState } from "react";
import { useCanvasState, useNow } from "../hooks";
import { Header } from "./Header";
import { ProgressBand } from "./ProgressBand";
import { Graph } from "./Graph";
import { JobDetail } from "./JobDetail";
import { Overlay } from "./Overlay";
import type { RunGraph } from "../types";

function Footer({ run }: { run: RunGraph }) {
    const left =
        `${run.nodes.length} jobs · ${run.edges.length} deps` + (run.flat ? " · flat" : "");
    const right = run.fetchedAt
        ? "updated " + new Date(run.fetchedAt).toLocaleTimeString()
        : "";
    return (
        <footer>
            <span>{left}</span>
            <span>{right}</span>
        </footer>
    );
}

function RunView({ run }: { run: RunGraph }) {
    const now = useNow(run.status !== "completed");
    // Detail overlay is keyed by node id (not the node object) so it always
    // resolves the freshest node from the live run state on every poll.
    const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
    const selected = selectedJobId
        ? run.nodes.find((n) => n.id === selectedJobId) ?? null
        : null;
    return (
        <>
            <Header run={run} />
            <ProgressBand run={run} now={now} />
            <Graph run={run} now={now} onOpenDetail={(node) => setSelectedJobId(node.id)} />
            <Footer run={run} />
            {selected && (
                <JobDetail run={run} node={selected} onClose={() => setSelectedJobId(null)} />
            )}
        </>
    );
}

export function App() {
    const state = useCanvasState();
    const run = state.status === "ok" ? state.run : null;
    return <div className="awv">{run ? <RunView run={run} /> : <Overlay state={state} />}</div>;
}
