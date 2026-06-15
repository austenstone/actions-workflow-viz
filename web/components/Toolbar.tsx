import { useState } from "react";
import { Button } from "@primer/react";
import type { RunGraph } from "../types";
import { FAIL_CONCLUSIONS } from "../format";
import { useAction } from "../hooks";
import { useToast } from "./Toast";
import { CancelConfirmDialog, shouldSkipCancelConfirm } from "./CancelConfirmDialog";

type ToolKind = "cancel_run" | "rerun_failed" | "rerun_all";

interface ToolDef {
    kind: ToolKind;
    label: string;
    busy: string;
    ok: string;
    variant: "danger" | "primary" | "default";
}

const TOOL_DEFS: ToolDef[] = [
    { kind: "cancel_run", label: "Cancel run", busy: "Cancelling…", ok: "Cancelling run…", variant: "danger" },
    { kind: "rerun_failed", label: "Re-run failed", busy: "Re-running…", ok: "Re-running failed jobs…", variant: "default" },
    { kind: "rerun_all", label: "Re-run all", busy: "Re-running…", ok: "Re-running all jobs…", variant: "primary" },
];

// The run-level action bar. Which buttons show depends on run state: cancel while
// active, re-run failed once it's finished with failures, re-run all once done.
export function Toolbar({ run }: { run: RunGraph }) {
    const callAction = useAction();
    const showToast = useToast();
    const [busy, setBusy] = useState<ToolKind | null>(null);
    const [confirming, setConfirming] = useState(false);

    const completed = run.status === "completed";
    const failed = completed && FAIL_CONCLUSIONS.includes(run.conclusion ?? "");
    const want: Record<ToolKind, boolean> = {
        cancel_run: !completed,
        rerun_failed: failed,
        rerun_all: completed,
    };

    const runAction = (def: ToolDef) => {
        if (busy) return;
        setBusy(def.kind);
        callAction(def.kind)
            .then(() => showToast(def.ok))
            .catch((e) => showToast((e as Error).message || "Action failed", true))
            .finally(() => setBusy(null));
    };

    const onClick = (def: ToolDef) => {
        if (def.kind === "cancel_run" && !shouldSkipCancelConfirm()) {
            setConfirming(true);
            return;
        }
        runAction(def);
    };

    const visible = TOOL_DEFS.filter((d) => want[d.kind]);
    if (!visible.length) return null;

    const cancelDef = TOOL_DEFS[0];

    return (
        <div className="h-tools">
            {visible.map((def) => (
                <Button
                    key={def.kind}
                    size="small"
                    variant={def.variant}
                    disabled={busy !== null}
                    onClick={() => onClick(def)}
                >
                    {busy === def.kind ? def.busy : def.label}
                </Button>
            ))}
            {confirming && (
                <CancelConfirmDialog
                    onConfirm={() => {
                        setConfirming(false);
                        runAction(cancelDef);
                    }}
                    onClose={() => setConfirming(false)}
                />
            )}
        </div>
    );
}
