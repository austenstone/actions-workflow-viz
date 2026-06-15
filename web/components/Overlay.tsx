import { useState } from "react";
import type { CanvasState, RunSummary } from "../types";
import { summaryPill, relTime } from "../format";
import { useAction } from "../hooks";

// One selectable run in the picker. Clicking loads it via the existing load_run
// action; a per-row busy flag keeps the rest of the list interactive.
function RunRow({ run, repo }: { run: RunSummary; repo: string | null }) {
    const callAction = useAction();
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const pill = summaryPill(run);

    const pick = () => {
        if (busy) return;
        setBusy(true);
        setErr(null);
        callAction<{ status?: string; message?: string }>("load_run", {
            repo: repo ?? undefined,
            runId: run.id,
        })
            .then((res) => {
                if (res?.status === "error") {
                    setErr(res.message || "Couldn't load run");
                    setBusy(false);
                }
            })
            .catch((e) => {
                setErr((e as Error).message || "Couldn't load run");
                setBusy(false);
            });
    };

    return (
        <button
            type="button"
            className="run-row"
            onClick={pick}
            disabled={busy}
            title={run.title || run.name}
        >
            <span className={"dot " + pill.cls} />
            <span className="run-row-main">
                <span className="run-row-title">{run.title || run.name}</span>
                <span className="run-row-meta">
                    {run.runNumber != null && <span>#{run.runNumber}</span>}
                    {run.branch && <span>⏎ {run.branch}</span>}
                    {run.event && <span>{run.event}</span>}
                    {run.createdAt && <span>{relTime(run.createdAt)}</span>}
                </span>
                {err && <span className="run-row-err">{err}</span>}
            </span>
            <span className={"pill " + pill.cls}>{pill.text}</span>
        </button>
    );
}

// Browse mode: the list of recent runs to choose from when nothing is loaded.
function RunPickerView({ state }: { state: CanvasState }) {
    const callAction = useAction();
    const picker = state.picker!;
    const [refreshing, setRefreshing] = useState(false);

    const refresh = () => {
        if (refreshing) return;
        setRefreshing(true);
        callAction("list_runs", picker.repo ? { repo: picker.repo } : {}).finally(() =>
            setRefreshing(false),
        );
    };

    return (
        <div className="picker">
            <div className="picker-head">
                <div className="picker-titles">
                    <div className="big">Recent runs</div>
                    {picker.repo && <div className="muted">{picker.repo}</div>}
                </div>
                <button
                    type="button"
                    className="h-back"
                    onClick={refresh}
                    disabled={refreshing || picker.loading}
                >
                    {refreshing ? "Refreshing…" : "↻ Refresh"}
                </button>
            </div>

            {picker.loading ? (
                <div className="picker-state">
                    <div className="spin" />
                    <div>Loading runs…</div>
                </div>
            ) : picker.error ? (
                <div className="picker-state">
                    <div className="big">Couldn't list runs</div>
                    <div className="muted">{picker.error}</div>
                </div>
            ) : picker.runs.length === 0 ? (
                <div className="picker-state">
                    <div>No runs found.</div>
                </div>
            ) : (
                <div className="run-list">
                    {picker.runs.map((run) => (
                        <RunRow key={run.id} run={run} repo={picker.repo} />
                    ))}
                </div>
            )}
        </div>
    );
}

// The full-surface state screen shown when there's no run to render. Browse mode
// (a run picker) takes priority; otherwise the old idle/loading/error overlay.
export function Overlay({ state }: { state: CanvasState }) {
    if (state.status === "loading") {
        return (
            <div className="overlay">
                <div className="spin" />
                <div className="big">Loading run…</div>
                {state.message && <div>{state.message}</div>}
            </div>
        );
    }

    if (state.picker) {
        return <RunPickerView state={state} />;
    }

    const title = state.status === "error" ? "Couldn't load run" : "No run loaded";
    const msg =
        state.message ||
        (state.status === "idle" ? "Use the load_run action to point this at a run." : "");

    return (
        <div className="overlay">
            <div className="big">{title}</div>
            {msg && <div>{msg}</div>}
        </div>
    );
}
