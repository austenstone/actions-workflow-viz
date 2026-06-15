import type { ReactNode } from "react";
import { Button, Link, Avatar, Label } from "@primer/react";
import { ChevronLeftIcon } from "@primer/octicons-react";
import type { RunGraph } from "../types";
import { runPill, labelVariant } from "../format";
import { useChangeFx, PILL_POP, PILL_POP_KEYS } from "../anim";
import { useAction } from "../hooks";
import { Toolbar } from "./Toolbar";

// Build the meta line links (repo, run number, branch, sha, event, actor).
function MetaLinks({ run }: { run: RunGraph }) {
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
    if (run.head_branch && ghBase) {
        bits.push(
            <span key="branch">
                ⏎{" "}
                <Link muted href={`${ghBase}/tree/${encodeURIComponent(run.head_branch)}`} {...ext}>
                    {run.head_branch}
                </Link>
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
    if (run.event) {
        bits.push(
            <span key="event">
                <Link
                    muted
                    href={`https://docs.github.com/actions/using-workflows/events-that-trigger-workflows#${run.event}`}
                    {...ext}
                >
                    {run.event}
                </Link>
            </span>,
        );
    }
    if (run.actor) {
        bits.push(
            <span key="actor">
                <Link
                    muted
                    href={run.actor.html_url ?? `https://github.com/${run.actor.login}`}
                    className="actor"
                    {...ext}
                >
                    <Avatar
                        src={run.actor.avatar_url ?? `https://github.com/${run.actor.login}.png?size=32`}
                        alt={run.actor.login}
                        size={16}
                    />
                    {run.actor.login}
                </Link>
            </span>,
        );
    }
    return <>{bits}</>;
}

export function Header({ run }: { run: RunGraph }) {
    const callAction = useAction();
    const pill = runPill(run);
    const pillRef = useChangeFx<HTMLSpanElement>(pill.cls, () => ({
        keys: PILL_POP_KEYS,
        transition: PILL_POP,
    }));

    const title = run.name || run.display_title || "Workflow Run";

    return (
        <header>
            <div className="h-top">
                <Button
                    size="small"
                    variant="invisible"
                    leadingVisual={ChevronLeftIcon}
                    title="Browse recent runs"
                    onClick={() => callAction("list_runs", run.repo ? { repo: run.repo } : {})}
                >
                    Runs
                </Button>
                <h1 className="h-title" title={title}>
                    {title}
                </h1>
                <span className="h-pill" ref={pillRef}>
                    <Label variant={labelVariant(pill.cls)}>{pill.text}</Label>
                </span>
                <Toolbar run={run} />
            </div>
            <div className="h-meta">
                <MetaLinks run={run} />
            </div>
        </header>
    );
}
