import { useCanvasState, useNow } from "../hooks";
import { Header } from "./Header";
import { ProgressBand } from "./ProgressBand";
import { Graph } from "./Graph";
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
    return (
        <>
            <Header run={run} />
            <ProgressBand run={run} now={now} />
            <Graph run={run} now={now} />
            <Footer run={run} />
        </>
    );
}

export function App() {
    const state = useCanvasState();
    const run = state.status === "ok" ? state.run : null;
    return <div className="awv">{run ? <RunView run={run} /> : <Overlay state={state} />}</div>;
}
