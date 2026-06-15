// Pure formatting + status-mapping helpers, lifted verbatim from the old
// index.html renderer so the visual semantics are unchanged.
import type { GraphNode, RunGraph, RunSummary } from "./types";

export type StatusClass = "ok" | "fail" | "run" | "wait" | "skip";

export interface StatusInfo {
    cls: StatusClass;
    ico: string;
    label: string;
}

export const FAIL_CONCLUSIONS = ["failure", "timed_out"];
export const RERUNNABLE_CLS: StatusClass[] = ["ok", "fail", "skip"];

export function fmtDur(ms: number | null | undefined): string {
    if (ms == null || ms < 0) return "";
    const s = Math.floor(ms / 1000);
    if (s < 60) return s + "s";
    const m = Math.floor(s / 60);
    const r = s % 60;
    if (m < 60) return r ? `${m}m ${r}s` : `${m}m`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
}

export function durOf(node: GraphNode, now: number): string {
    if (!node.started_at) return "";
    const start = new Date(node.started_at).getTime();
    const end = node.completed_at ? new Date(node.completed_at).getTime() : now;
    return fmtDur(end - start);
}

export function elapsedOf(run: RunGraph, now: number): string {
    if (!run.run_started_at) return "";
    const start = new Date(run.run_started_at).getTime();
    const end =
        run.status === "completed" && run.updated_at
            ? new Date(run.updated_at).getTime()
            : now;
    return fmtDur(end - start);
}

// -> { cls, ico, label } where cls in ok|fail|run|wait|skip
export function statusOf(node: GraphNode): StatusInfo {
    if (node.status === "in_progress") return { cls: "run", ico: "", label: "Running" };
    if (node.status === "queued") return { cls: "wait", ico: "○", label: "Queued" };
    if (node.status === "pending") return { cls: "wait", ico: "○", label: "Pending" };
    const c = node.conclusion;
    if (c === "success") return { cls: "ok", ico: "✓", label: "Passed" };
    if (c === "skipped") return { cls: "skip", ico: "↷", label: "Skipped" };
    if (c === "cancelled") return { cls: "skip", ico: "⊘", label: "Cancelled" };
    if (c === "neutral" || c === "action_required")
        return { cls: "wait", ico: "!", label: c };
    return { cls: "fail", ico: "✕", label: c === "timed_out" ? "Timed out" : "Failed" };
}

export interface LegProgress {
    done: number;
    total: number;
}

export function legProgress(node: GraphNode): LegProgress {
    const total = node.legs.length;
    const done = node.legs.filter((l) => l.status === "completed").length;
    return { done, total };
}

export interface StepProgress {
    done: number;
    total: number;
    cur: string | null;
}

export function stepProgress(node: GraphNode): StepProgress | null {
    if (node.legs.length !== 1) return null;
    const steps = node.legs[0].steps || [];
    if (!steps.length) return null;
    const total = steps.length;
    const done = steps.filter((s) => s.status === "completed").length;
    const cur = steps.find((s) => s.status === "in_progress");
    return { done, total, cur: cur ? cur.name : null };
}

// Same mapping as runPill, but driven by the flat status/conclusion strings a
// RunSummary carries (browse-mode list rows).
export function summaryPill(run: RunSummary): { cls: StatusClass; text: string } {
    if (run.status === "completed") {
        const cls: StatusClass =
            run.conclusion === "success"
                ? "ok"
                : run.conclusion === "skipped" || run.conclusion === "cancelled"
                  ? "wait"
                  : "fail";
        return { cls, text: run.conclusion || "completed" };
    }
    if (run.status === "in_progress") return { cls: "run", text: "in progress" };
    return { cls: "wait", text: run.status ?? "queued" };
}

// Compact "5m", "3h", "2d" style relative age for list rows.
export function relTime(iso: string | null): string {
    if (!iso) return "";
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return "";
    const s = Math.floor((Date.now() - then) / 1000);
    if (s < 60) return `${Math.max(s, 0)}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
}
export function runPill(run: RunGraph): { cls: StatusClass; text: string } {
    if (run.status === "completed") {
        const cls: StatusClass =
            run.conclusion === "success"
                ? "ok"
                : run.conclusion === "skipped" || run.conclusion === "cancelled"
                  ? "wait"
                  : "fail";
        return { cls, text: run.conclusion || "completed" };
    }
    if (run.status === "in_progress") return { cls: "run", text: "in progress" };
    return { cls: "wait", text: run.status ?? "queued" };
}
