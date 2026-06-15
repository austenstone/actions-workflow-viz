import { useEffect, useMemo, useRef } from "react";
import type { Step } from "../types";
import { fmtDur } from "../format";

// Live step-event feed. GitHub only publishes the REST job-log blob when the
// whole job completes (in-progress jobs return 404 BlobNotFound), so there is no
// in-progress log TEXT to tail. The jobs API does report per-step status + timing
// live, though, so while a job runs we synthesize a streaming activity log from
// those transitions: completed steps land as finalized lines, the running step
// ticks live, and queued steps trail. On completion the parent swaps this out for
// the real per-step logs.

function doneGlyph(step: Step): { ico: string; cls: string } {
    const c = step.conclusion;
    if (c === "success") return { ico: "✓", cls: "ok" };
    if (c === "skipped") return { ico: "↷", cls: "skip" };
    if (c === "cancelled") return { ico: "⊘", cls: "skip" };
    if (c === "failure" || c === "timed_out") return { ico: "✕", cls: "fail" };
    return { ico: "•", cls: "wait" };
}

function clockTime(iso: string | null | undefined): string {
    if (!iso) return "";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour12: false });
}

function stepDurMs(step: Step, now: number): number | null {
    if (!step.started_at) return null;
    const start = new Date(step.started_at).getTime();
    if (Number.isNaN(start)) return null;
    const end = step.completed_at ? new Date(step.completed_at).getTime() : now;
    return end - start;
}

export function StepActivityFeed({ steps, now }: { steps: Step[]; now: number }) {
    const ordered = useMemo(() => [...steps].sort((a, b) => a.number - b.number), [steps]);
    const done = ordered.filter((s) => s.status === "completed");
    const running = ordered.find((s) => s.status === "in_progress") ?? null;
    const queued = ordered.filter(
        (s) => s.status !== "completed" && s.status !== "in_progress",
    ).length;

    // Keep the newest event in view as the feed grows. Only re-pins when the set
    // of finalized lines or the running step changes — not on every now-tick.
    const feedRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = feedRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [done.length, running?.number]);

    return (
        <div className="jd-live" role="status" aria-live="polite">
            <div className="jd-live-head">
                <span className="jd-live-dot" />
                Live activity — step events stream in real time. Full logs publish when the job
                finishes.
            </div>
            <div className="jd-live-feed" ref={feedRef}>
                {done.map((s) => {
                    const g = doneGlyph(s);
                    const dur = fmtDur(stepDurMs(s, now));
                    return (
                        <div key={s.number} className={"jd-live-line " + g.cls}>
                            <span className="jd-live-ts">{clockTime(s.completed_at)}</span>
                            <span className={"jd-live-ico " + g.cls}>{g.ico}</span>
                            <span className="jd-live-name" title={s.name}>
                                {s.name}
                            </span>
                            {dur && <span className="jd-live-dur">{dur}</span>}
                        </div>
                    );
                })}
                {running && (
                    <div className="jd-live-line run cur">
                        <span className="jd-live-ts">{clockTime(running.started_at)}</span>
                        <span className="jd-live-ico run">▶</span>
                        <span className="jd-live-name" title={running.name}>
                            {running.name}
                        </span>
                        <span className="jd-live-dur">{fmtDur(stepDurMs(running, now))}</span>
                    </div>
                )}
                {!done.length && !running && (
                    <div className="jd-live-line wait">
                        <span className="jd-live-ico wait">○</span>
                        <span className="jd-live-name">Waiting for the first step to start…</span>
                    </div>
                )}
                {queued > 0 && (
                    <div className="jd-live-queued">
                        +{queued} step{queued === 1 ? "" : "s"} queued
                    </div>
                )}
            </div>
        </div>
    );
}
