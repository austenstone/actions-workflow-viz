import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
    Avatar,
    IconButton,
    Label,
    Link,
    SegmentedControl,
    Spinner,
    TextInput,
} from "@primer/react";
import {
    ChevronDownIcon,
    ChevronRightIcon,
    LinkExternalIcon,
    SearchIcon,
    XIcon,
    AlertIcon,
    InfoIcon,
    StopIcon,
} from "@primer/octicons-react";
import type { Annotation, GraphNode, Leg, RunGraph, Step } from "../types";
import { fmtDur, labelVariant, type StatusInfo } from "../format";
import { useAction, useNow } from "../hooks";
import { LogTerminal } from "./LogTerminal";
import { StepActivityFeed } from "./StepActivityFeed";
import { StatusIcon } from "./StatusIcon";

type Mode = "formatted" | "raw";

interface LogStep {
    number: number;
    name: string;
    logText: string;
}

interface JobLogResult {
    jobId: number;
    status: string;
    conclusion: string | null;
    steps: LogStep[];
}

// Leading per-line ISO timestamp GitHub prefixes to every log line. We keep it
// in Raw view and strip it for the Formatted terminal.
const WEB_TS = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s/;

const stripTs = (line: string): string => line.replace(WEB_TS, "");

// Step-level status glyphs. Steps use the same status vocabulary as jobs minus
// "pending", so this mirrors statusOf without pulling in the GraphNode shape.
function stepStatus(step: Step): StatusInfo {
    if (step.status === "in_progress") return { cls: "run", kind: "in_progress", ico: "", label: "Running" };
    if (step.status === "queued") return { cls: "wait", kind: "queued", ico: "○", label: "Queued" };
    const c = step.conclusion;
    if (c === "success") return { cls: "ok", kind: "success", ico: "✓", label: "Passed" };
    if (c === "skipped") return { cls: "skip", kind: "skipped", ico: "↷", label: "Skipped" };
    if (c === "cancelled") return { cls: "skip", kind: "cancelled", ico: "⊘", label: "Cancelled" };
    if (c === "failure" || c === "timed_out")
        return { cls: "fail", kind: "failure", ico: "✕", label: c === "timed_out" ? "Timed out" : "Failed" };
    if (c) return { cls: "wait", kind: "neutral", ico: "!", label: c };
    return { cls: "wait", kind: "pending", ico: "·", label: step.status };
}

function stepDur(step: Step, now: number): string {
    if (!step.started_at) return "";
    const start = new Date(step.started_at).getTime();
    const end = step.completed_at ? new Date(step.completed_at).getTime() : now;
    return fmtDur(end - start);
}

// Pick which steps open by default: whatever is running, else the first
// failure, else nothing.
function defaultOpen(steps: Step[]): Set<number> {
    const open = new Set<number>();
    const running = steps.find((s) => s.status === "in_progress");
    if (running) {
        open.add(running.number);
        return open;
    }
    const failed = steps.find(
        (s) => s.conclusion === "failure" || s.conclusion === "timed_out",
    );
    if (failed) open.add(failed.number);
    return open;
}

// Highlight every case-insensitive match of `q` in a Raw log line.
function highlight(line: string, q: string): ReactNode {
    if (!q) return line;
    const lower = line.toLowerCase();
    const out: ReactNode[] = [];
    let i = 0;
    let n = 0;
    for (;;) {
        const hit = lower.indexOf(q, i);
        if (hit === -1) {
            out.push(line.slice(i));
            break;
        }
        if (hit > i) out.push(line.slice(i, hit));
        out.push(
            <mark key={n++} className="hl">
                {line.slice(hit, hit + q.length)}
            </mark>,
        );
        i = hit + q.length;
    }
    return out;
}

function RawLog({ text, q }: { text: string; q: string }) {
    const lines = useMemo(() => {
        const all = text.split("\n");
        return q ? all.filter((l) => l.toLowerCase().includes(q)) : all;
    }, [text, q]);
    return (
        <pre className="rawlog">
            {lines.map((l, i) => (
                <div key={i} className="rawline">
                    {highlight(l, q)}
                </div>
            ))}
        </pre>
    );
}

function StepRow({
    step,
    logText,
    mode,
    q,
    now,
    open,
    onToggle,
}: {
    step: Step;
    logText: string;
    mode: Mode;
    q: string;
    now: number;
    open: boolean;
    onToggle: () => void;
}) {
    const st = stepStatus(step);
    const dur = stepDur(step, now);
    const hasLog = logText.length > 0;
    const expandable = hasLog || step.status !== "completed";

    const formatted = useMemo(() => {
        if (mode !== "formatted") return "";
        const lines = logText.split("\n");
        const shown = q ? lines.filter((l) => l.toLowerCase().includes(q)) : lines;
        return shown.map(stripTs).join("\n");
    }, [mode, logText, q]);

    return (
        <div className={"jd-step s-" + st.cls + (open ? " open" : "") + (expandable ? "" : " no-expand")}>
            <button
                className="jd-step-head"
                onClick={expandable ? onToggle : undefined}
                aria-expanded={expandable ? open : undefined}
                disabled={!expandable}
            >
                <span className="jd-chev">
                    {expandable ? open ? <ChevronDownIcon /> : <ChevronRightIcon /> : null}
                </span>
                <span className="jd-step-ico">
                    <StatusIcon kind={st.kind} title={st.label} />
                </span>
                <span className="jd-step-name" title={step.name}>
                    {step.name}
                </span>
                {dur && <span className="jd-step-dur">{dur}</span>}
            </button>
            {expandable && open && (
                <div className="jd-step-body">
                    {!hasLog ? (
                        <div className="jd-step-empty">
                            {step.status === "completed"
                                ? "No log output."
                                : "Logs publish when the job finishes."}
                        </div>
                    ) : mode === "formatted" ? (
                        <LogTerminal text={formatted} />
                    ) : (
                        <RawLog text={logText} q={q} />
                    )}
                </div>
            )}
        </div>
    );
}

const ANN_ICON = {
    failure: <StopIcon />,
    warning: <AlertIcon />,
    notice: <InfoIcon />,
} as const;

const URL_RE = /(https?:\/\/[^\s]+)/g;

function linkify(text: string): ReactNode[] {
    const out: ReactNode[] = [];
    let last = 0;
    for (const m of text.matchAll(URL_RE)) {
        const idx = m.index ?? 0;
        if (idx > last) out.push(text.slice(last, idx));
        let href = m[0];
        let trail = "";
        while (/[.,);:\]]$/.test(href)) {
            trail = href.slice(-1) + trail;
            href = href.slice(0, -1);
        }
        out.push(
            <Link key={idx} href={href} target="_blank" rel="noopener">
                {href}
            </Link>,
        );
        if (trail) out.push(trail);
        last = idx + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
}

function AnnRow({ a }: { a: Annotation }) {
    const [expanded, setExpanded] = useState(false);
    const loc = a.path && a.path !== ".github" ? a.path : "";
    const line = a.startLine ? `:${a.startLine}` : "";
    const longMsg = a.message.length > 100 || a.message.includes("\n");
    const clamped = longMsg && !expanded;

    return (
        <div className={"jd-ann l-" + a.level}>
            <span className="jd-ann-ico">{ANN_ICON[a.level]}</span>
            <div className="jd-ann-body">
                {a.title && <div className="jd-ann-title">{a.title}</div>}
                {a.message && (
                    <div className={"jd-ann-msg" + (clamped ? " clamped" : "")}>
                        {clamped ? a.message : linkify(a.message)}
                    </div>
                )}
                {longMsg && (
                    <button
                        type="button"
                        className="jd-ann-toggle"
                        onClick={() => setExpanded((v) => !v)}
                        aria-expanded={expanded}
                    >
                        {expanded ? "Show less" : "Show more"}
                    </button>
                )}
                {loc &&
                    (a.blobHref ? (
                        <Link
                            muted
                            href={a.blobHref}
                            target="_blank"
                            rel="noopener"
                            className="jd-ann-loc"
                        >
                            {loc}
                            {line} <LinkExternalIcon size={12} />
                        </Link>
                    ) : (
                        <span className="jd-ann-loc">
                            {loc}
                            {line}
                        </span>
                    ))}
            </div>
        </div>
    );
}

function JobAnnotations({ anns }: { anns: Annotation[] }) {
    return (
        <div className="jd-anns">
            {anns.map((a, i) => (
                <AnnRow key={i} a={a} />
            ))}
        </div>
    );
}

function MetaBits({ run, leg }: { run: RunGraph; leg: Leg }) {
    const ghBase = run.repo ? `https://github.com/${run.repo}` : null;
    const ext = { target: "_blank", rel: "noopener" } as const;
    const bits: ReactNode[] = [];

    if (run.repo && ghBase) {
        const runUrl = run.html_url || (run.id ? `${ghBase}/actions/runs/${run.id}` : null);
        bits.push(
            <span key="repo">
                <Link muted href={ghBase} {...ext}>
                    {run.repo}
                </Link>{" "}
                {runUrl ? (
                    <Link muted href={runUrl} {...ext}>
                        #{run.run_number}
                    </Link>
                ) : (
                    `#${run.run_number}`
                )}
            </span>,
        );
    }
    if (run.head_sha && ghBase) {
        bits.push(
            <span key="sha">
                <Link muted href={`${ghBase}/commit/${run.head_sha}`} {...ext}>
                    <code>{run.head_sha.slice(0, 7)}</code>
                </Link>
            </span>,
        );
    }
    if (run.event) bits.push(<span key="event">{run.event}</span>);
    if (run.actor) {
        bits.push(
            <span key="actor" className="jd-actor">
                <Avatar
                    src={
                        run.actor.avatar_url ??
                        `https://github.com/${run.actor.login}.png?size=32`
                    }
                    alt={run.actor.login}
                    size={16}
                />
                {run.actor.login}
            </span>,
        );
    }
    const runner = (leg.labels || []).join(", ");
    if (runner) bits.push(<span key="runner">{runner}</span>);
    return <>{bits}</>;
}

export function JobDetail({
    run,
    node,
    onClose,
}: {
    run: RunGraph;
    node: GraphNode;
    onClose: () => void;
}) {
    const callAction = useAction();
    const [legIdx, setLegIdx] = useState(0);
    const leg = node.legs[legIdx] ?? node.legs[0];

    const [mode, setMode] = useState<Mode>("formatted");
    const [query, setQuery] = useState("");
    const [q, setQ] = useState("");
    const [logSteps, setLogSteps] = useState<Map<number, string>>(new Map());
    const [open, setOpen] = useState<Set<number>>(() => defaultOpen(leg?.steps ?? []));
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const busy = useRef(false);

    const running = leg ? leg.status !== "completed" : false;
    const now = useNow(running);

    // Debounce the search box so we don't refilter/remount terminals per keystroke.
    useEffect(() => {
        const t = setTimeout(() => setQ(query.trim().toLowerCase()), 150);
        return () => clearTimeout(t);
    }, [query]);

    const fetchLog = useCallback(() => {
        if (!leg || busy.current) return;
        busy.current = true;
        setLoading(true);
        callAction<JobLogResult>("getJobLog", { ghJobId: leg.id })
            .then((res) => {
                const map = new Map<number, string>();
                for (const s of res.steps) map.set(s.number, s.logText);
                setLogSteps(map);
                setErr(null);
            })
            .catch((e) => setErr((e as Error).message || "Couldn't load logs"))
            .finally(() => {
                busy.current = false;
                setLoading(false);
            });
    }, [callAction, leg]);

    // Reset view state whenever the selected leg changes (mount or matrix switch).
    useEffect(() => {
        if (!leg) return;
        setLogSteps(new Map());
        setOpen(defaultOpen(leg.steps ?? []));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [leg?.id]);

    // Fetch on mount, on leg switch, and on every status change. GitHub only
    // publishes the REST log blob when the whole job completes (in-progress jobs
    // return BlobNotFound), so the status->completed transition is exactly when
    // logs first become available — fetching here guarantees we load them then.
    // While the job runs we also poll as a fallback in case GitHub flushes early.
    useEffect(() => {
        if (!leg) return;
        fetchLog();
        if (leg.status === "completed") return;
        const t = setInterval(fetchLog, 5000);
        return () => clearInterval(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [leg?.id, leg?.status]);

    // Esc closes the overlay.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    const toggle = useCallback((num: number) => {
        setOpen((prev) => {
            const next = new Set(prev);
            if (next.has(num)) next.delete(num);
            else next.add(num);
            return next;
        });
    }, []);

    if (!leg) {
        return (
            <div className="jd">
                <div className="jd-head">
                    <div className="jd-head-top">
                        <h2 className="jd-title">{node.label}</h2>
                        <span className="jd-spacer" />
                        <IconButton icon={XIcon} aria-label="Close" variant="invisible" onClick={onClose} />
                    </div>
                </div>
                <div className="jd-empty">This job hasn't started yet.</div>
            </div>
        );
    }

    const st = stepStatus({ status: leg.status, conclusion: leg.conclusion } as Step);
    const steps = leg.steps ?? [];
    const legAnns = (node.annotations ?? []).filter((a) => !a.jobName || a.jobName === leg.name);
    const updated = run.fetchedAt ? new Date(run.fetchedAt).toLocaleTimeString() : "";

    return (
        <div className="jd" role="dialog" aria-label={node.label}>
            <div className="jd-head">
                <div className="jd-head-top">
                    <span className="jd-ico">
                        <StatusIcon kind={st.kind} title={st.label} />
                    </span>
                    <h2 className="jd-title" title={node.label}>
                        {node.label}
                    </h2>
                    <Label variant={labelVariant(st.cls)}>{st.label}</Label>
                    {node.legs.length > 1 && (
                        <SegmentedControl aria-label="Matrix leg" size="small">
                            {node.legs.map((l, i) => (
                                <SegmentedControl.Button
                                    key={l.id}
                                    selected={i === legIdx}
                                    onClick={() => setLegIdx(i)}
                                >
                                    {l.name.replace(/^.*\(/, "").replace(/\)$/, "") || l.name}
                                </SegmentedControl.Button>
                            ))}
                        </SegmentedControl>
                    )}
                    <span className="jd-spacer" />
                    {leg.html_url && (
                        <Link
                            muted
                            href={leg.html_url}
                            target="_blank"
                            rel="noopener"
                            className="jd-gh"
                        >
                            <LinkExternalIcon /> GitHub
                        </Link>
                    )}
                    <IconButton
                        icon={XIcon}
                        aria-label="Close"
                        variant="invisible"
                        onClick={onClose}
                    />
                </div>
                <div className="jd-meta">
                    <MetaBits run={run} leg={leg} />
                </div>
            </div>

            <div className="jd-controls">
                <TextInput
                    leadingVisual={SearchIcon}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search logs"
                    aria-label="Search logs"
                    size="small"
                    block
                />
                <SegmentedControl aria-label="Log view" size="small">
                    <SegmentedControl.Button
                        selected={mode === "formatted"}
                        onClick={() => setMode("formatted")}
                    >
                        Formatted
                    </SegmentedControl.Button>
                    <SegmentedControl.Button
                        selected={mode === "raw"}
                        onClick={() => setMode("raw")}
                    >
                        Raw
                    </SegmentedControl.Button>
                </SegmentedControl>
            </div>

            <div className="jd-steps">
                {err && <div className="jd-err">{err}</div>}
                {legAnns.length > 0 && <JobAnnotations anns={legAnns} />}
                {running && steps.length > 0 && <StepActivityFeed steps={steps} now={now} />}
                {steps.length === 0 ? (
                    <div className="jd-empty">
                        {loading ? <Spinner size="small" /> : "No steps reported yet."}
                    </div>
                ) : (
                    steps.map((step) => (
                        <StepRow
                            key={step.number}
                            step={step}
                            logText={logSteps.get(step.number) ?? ""}
                            mode={mode}
                            q={q}
                            now={now}
                            open={open.has(step.number)}
                            onToggle={() => toggle(step.number)}
                        />
                    ))
                )}
            </div>

            <div className="jd-foot">
                <span>
                    {steps.length} step{steps.length === 1 ? "" : "s"}
                    {loading ? " · loading…" : ""}
                </span>
                {updated && <span>updated {updated}</span>}
            </div>
        </div>
    );
}
