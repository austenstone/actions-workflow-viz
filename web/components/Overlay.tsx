import { useState } from "react";
import { Button, Spinner, ActionList, Avatar } from "@primer/react";
import { SyncIcon, AlertIcon, StopIcon } from "@primer/octicons-react";
import type { CanvasState, RunSummary } from "../types";
import { summaryStatus, relTime, runElapsed } from "../format";
import { useAction, useNow } from "../hooks";
import { StatusIcon } from "./StatusIcon";

// One selectable run in the picker. Clicking loads it via the existing load_run
// action; a per-row busy flag keeps the rest of the list interactive.
function RunRow({ run, repo }: { run: RunSummary; repo: string | null }) {
    const callAction = useAction();
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const status = summaryStatus(run);
    const running = run.status !== "completed";
    const now = useNow(running);

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

    const avatarUrl =
        run.actor?.avatar_url ??
        (run.actor ? `https://github.com/${run.actor.login}.png?size=40` : null);

    // PR runs flow head -> base; everything else is just the one branch.
    const refFlow =
        run.baseBranch && run.branch ? `${run.branch} → ${run.baseBranch}` : run.branch;
    const sha = run.headSha ? run.headSha.slice(0, 7) : null;

    const time = running
        ? runElapsed(run, now)
        : run.createdAt
          ? relTime(run.createdAt)
          : "";

    return (
        <ActionList.Item onSelect={pick} disabled={busy} title={run.title || run.name}>
            <ActionList.LeadingVisual>
                {avatarUrl ? (
                    <Avatar src={avatarUrl} alt={run.actor?.login ?? "actor"} size={20} />
                ) : (
                    <StatusIcon kind={status.kind} title={status.label} />
                )}
            </ActionList.LeadingVisual>
            {run.title || run.name}
            <ActionList.Description variant="block">
                <span className="run-row-meta">
                    {run.runNumber != null && <span>#{run.runNumber}</span>}
                    {refFlow && <span className="branch">⏎ {refFlow}</span>}
                    {sha && <code className="sha">{sha}</code>}
                    {run.event && <span>{run.event}</span>}
                </span>
                {err && <span className="run-row-err">{err}</span>}
            </ActionList.Description>
            <ActionList.TrailingVisual>
                <span className="run-row-trail">
                    <span className="run-row-trail-top">
                        {run.annotations && (
                            <span className="run-row-anns">
                                {run.annotations.failure > 0 && (
                                    <span
                                        className="ann-count l-failure"
                                        title={`${run.annotations.failure} error${run.annotations.failure === 1 ? "" : "s"}`}
                                    >
                                        <StopIcon size={12} />
                                        {run.annotations.failure}
                                    </span>
                                )}
                                {run.annotations.warning > 0 && (
                                    <span
                                        className="ann-count l-warning"
                                        title={`${run.annotations.warning} warning${run.annotations.warning === 1 ? "" : "s"}`}
                                    >
                                        <AlertIcon size={12} />
                                        {run.annotations.warning}
                                    </span>
                                )}
                            </span>
                        )}
                        <StatusIcon kind={status.kind} title={status.label} className="run-row-status" />
                    </span>
                    {time && <span className="run-row-time">{time}</span>}
                </span>
            </ActionList.TrailingVisual>
        </ActionList.Item>
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
                <Button
                    size="small"
                    variant="invisible"
                    leadingVisual={SyncIcon}
                    onClick={refresh}
                    disabled={refreshing || picker.loading}
                >
                    {refreshing ? "Refreshing…" : "Refresh"}
                </Button>
            </div>

            {picker.loading ? (
                <div className="picker-state">
                    <Spinner size="small" />
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
                    <ActionList>
                        {picker.runs.map((run) => (
                            <RunRow key={run.id} run={run} repo={picker.repo} />
                        ))}
                    </ActionList>
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
                <Spinner size="medium" />
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
