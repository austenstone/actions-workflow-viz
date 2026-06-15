import type { RunGraph } from "../types";
import { elapsedOf, statusOf } from "../format";

// The segmented progress bar + summary line under the header. Segment widths
// animate via the CSS width transition on `.prog-bar i` (no JS needed).
export function ProgressBand({ run, now }: { run: RunGraph; now: number }) {
    const total = run.nodes.length || 1;
    let ok = 0;
    let fail = 0;
    let runc = 0;
    let skip = 0;
    let wait = 0;
    for (const n of run.nodes) {
        const s = statusOf(n).cls;
        if (s === "ok") ok++;
        else if (s === "fail") fail++;
        else if (s === "run") runc++;
        else if (s === "skip") skip++;
        else wait++;
    }
    const pct = (n: number) => (n / total) * 100 + "%";
    const finished = ok + fail + skip;
    const elapsed = elapsedOf(run, now);

    return (
        <div className="prog">
            <div className="prog-bar">
                <i className="ok" style={{ width: pct(ok) }} />
                <i className="fail" style={{ width: pct(fail) }} />
                <i className="run" style={{ width: pct(runc) }} />
                <i className="skip" style={{ width: pct(skip) }} />
            </div>
            <div className="prog-meta">
                <span className="big">
                    {finished}/{total} jobs
                </span>
                {elapsed && (
                    <>
                        <span className="sep">·</span>
                        <span>{elapsed}</span>
                    </>
                )}
                {(runc > 0 || fail > 0 || wait > 0) && <span className="sep">·</span>}
                {runc > 0 && (
                    <span className="cnt">
                        <span className="swatch" style={{ background: "var(--run)" }} />
                        {runc} running
                    </span>
                )}
                {fail > 0 && (
                    <>
                        {runc > 0 && <span className="sep">·</span>}
                        <span className="cnt">
                            <span className="swatch" style={{ background: "var(--fail)" }} />
                            {fail} failed
                        </span>
                    </>
                )}
                {wait > 0 && (
                    <>
                        {(runc > 0 || fail > 0) && <span className="sep">·</span>}
                        <span className="cnt">
                            <span className="swatch" style={{ background: "var(--wait)" }} />
                            {wait} queued
                        </span>
                    </>
                )}
            </div>
        </div>
    );
}
