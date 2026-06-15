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
    const elapsed = elapsedOf(run, now);

    const legend = [
        { n: ok, color: "var(--ok)", label: "done" },
        { n: runc, color: "var(--run)", label: "in progress" },
        { n: fail, color: "var(--fail)", label: "failed" },
        { n: wait, color: "var(--wait)", label: "queued" },
        { n: skip, color: "var(--wait)", label: "skipped", faint: true },
    ].filter((s) => s.n > 0);

    return (
        <div className="prog">
            <div className="prog-bar">
                <i className="ok" style={{ width: pct(ok) }} />
                <i className="fail" style={{ width: pct(fail) }} />
                <i className="run" style={{ width: pct(runc) }} />
                <i className="skip" style={{ width: pct(skip) }} />
            </div>
            <div className="prog-meta">
                {legend.map((s) => (
                    <span className="cnt" key={s.label} style={s.faint ? { opacity: 0.7 } : undefined}>
                        <span
                            className="dot"
                            style={{ background: s.color, opacity: s.faint ? 0.55 : 1 }}
                        />
                        {s.n} {s.label}
                    </span>
                ))}
                {elapsed && <span className="dur">{elapsed}</span>}
            </div>
        </div>
    );
}
