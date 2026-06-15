import type { SyntheticEvent } from "react";
import { useCallback, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ActionList, ActionMenu, IconButton, Label } from "@primer/react";
import { KebabHorizontalIcon, SyncIcon } from "@primer/octicons-react";
import type { GraphNode } from "../types";
import {
    durOf,
    legProgress,
    queueMsOf,
    QUEUE_NOISE_MS,
    RERUNNABLE_CLS,
    runnerOf,
    statusOf,
    stepProgress,
    fmtDur,
} from "../format";
import {
    ENTER_TRANSITION,
    enterDelay,
    POP,
    POP_KEYS,
    SHAKE,
    SHAKE_KEYS,
    FILL_SPRING,
    useChangeFx,
} from "../anim";
import { useAction } from "../hooks";
import { useToast } from "./Toast";

interface JobCardProps {
    node: GraphNode;
    index: number;
    now: number;
    runCompleted: boolean;
    registerCard: (id: string, el: HTMLElement | null) => void;
}

// One DAG node. Clicking pushes the job's logs into the agent's context; the
// status glyph pops/shakes on transitions; an in-progress job shows a step bar.
// Layout/animation effects intentionally exclude `now` so the 1s tick only
// updates duration text, never restarts animations.
export function JobCard({ node, index, now, runCompleted, registerCard }: JobCardProps) {
    const callAction = useAction();
    const showToast = useToast();
    const reduce = useReducedMotion();

    const st = statusOf(node);
    const lp = legProgress(node);
    const inProgress = node.status === "in_progress";
    const canRerun = runCompleted && RERUNNABLE_CLS.includes(st.cls);

    const setCardRef = useCallback(
        (el: HTMLAnchorElement | null) => {
            registerCard(node.id, el);
        },
        [node.id, registerCard],
    );

    // Pop (or shake, on failure) the glyph when the status class changes.
    const icoRef = useChangeFx<HTMLSpanElement>(st.cls, (next) =>
        next === "fail"
            ? { keys: SHAKE_KEYS, transition: SHAKE }
            : { keys: POP_KEYS, transition: POP },
    );

    // Step / leg progress bar.
    const sp = inProgress ? stepProgress(node) : null;
    const pct = inProgress
        ? sp
            ? sp.total
                ? sp.done / sp.total
                : 0
            : lp.total
              ? lp.done / lp.total
              : 0
        : 0;
    const wpct = Math.round(pct * 100);
    const stepLabel =
        sp && sp.cur
            ? `▸ ${sp.cur}`
            : node.matrix && lp.total
              ? `${lp.done}/${lp.total} legs done`
              : "running…";

    // Add-to-context pill (debounced per card).
    const [ctx, setCtx] = useState<{ text: string; show: boolean }>({ text: "", show: false });
    const ctxBusy = useRef(false);
    const addContext = useCallback(() => {
        if (ctxBusy.current) return;
        ctxBusy.current = true;
        setCtx({ text: "Adding…", show: true });
        callAction("addContext", { jobId: node.id })
            .then(() => {
                setCtx({ text: "📎 Added ✓", show: true });
                setTimeout(() => setCtx((c) => ({ ...c, show: false })), 2000);
            })
            .catch(() => setCtx({ text: "context failed", show: true }))
            .finally(() => {
                ctxBusy.current = false;
            });
    }, [callAction, node.id]);

    const onActivate = (e: SyntheticEvent) => {
        e.preventDefault();
        addContext();
    };

    // Per-card re-run.
    const [rerunBusy, setRerunBusy] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const fireRerun = (e: SyntheticEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (rerunBusy) return;
        setRerunBusy(true);
        callAction("rerun_job", { jobId: node.id })
            .then(() => showToast(`Re-running ${node.label}…`))
            .catch((err) => showToast((err as Error).message || "Re-run failed", true))
            .finally(() => setRerunBusy(false));
    };

    const durTxt = durOf(node, now) || st.label;
    let tagTxt: string | null = null;
    if (node.matrix && node.legs.length) tagTxt = `${lp.done}/${lp.total} legs`;
    else if (node.status === "completed") tagTxt = st.label;

    // Runner labels (runs-on) and queue latency — pulled from the live legs but
    // never surfaced before. Runner shows the union across matrix legs; queue is
    // hidden when it's just scheduling noise.
    const runners = runnerOf(node);
    const runnerTxt = runners.length ? runners.join(", ") : null;
    const queueMs = queueMsOf(node);
    const queueTxt = queueMs != null && queueMs >= QUEUE_NOISE_MS ? fmtDur(queueMs) : null;

    const mtxTxt = node.legs.length ? `matrix · ${node.legs.length}` : "matrix";
    const mtxTip = node.legs.length
        ? node.legs.map((l) => `${l.name} — ${l.conclusion || l.status}`).join("\n")
        : "waiting for matrix legs…";

    return (
        // eslint-disable-next-line jsx-a11y/anchor-is-valid
        <motion.a
            ref={setCardRef}
            className={"card s-" + st.cls}
            data-id={node.id}
            role="button"
            tabIndex={0}
            initial={reduce ? false : { opacity: 0, y: 6, scale: 0.975 }}
            animate={{
                opacity: 1,
                y: 0,
                scale: 1,
                transition: { ...ENTER_TRANSITION, delay: enterDelay(index) },
            }}
            whileHover={{ y: -1, transition: { duration: 0.12, ease: "easeOut" } }}
            onClick={onActivate}
            onContextMenu={(e) => {
                if (!canRerun) return;
                e.preventDefault();
                e.stopPropagation();
                setMenuOpen(true);
            }}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onActivate(e);
            }}
        >
            <div className="c-top">
                <span className={"ico " + st.cls} ref={icoRef}>
                    {st.ico}
                </span>
                <span className="c-name-wrap">
                    <span className="c-name" title={node.label}>
                        {node.label}
                    </span>
                    {node.matrix && (
                        <span className="mtx" title={mtxTip}>
                            {mtxTxt}
                        </span>
                    )}
                </span>
                {canRerun && (
                    <span
                        className="rerun-bar"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                    >
                        <ActionMenu open={menuOpen} onOpenChange={setMenuOpen}>
                            <ActionMenu.Anchor>
                                <IconButton
                                    icon={KebabHorizontalIcon}
                                    size="small"
                                    variant="invisible"
                                    aria-label={"Actions for " + node.label}
                                />
                            </ActionMenu.Anchor>
                            <ActionMenu.Overlay width="small">
                                <ActionList>
                                    <ActionList.Item disabled={rerunBusy} onSelect={fireRerun}>
                                        <ActionList.LeadingVisual>
                                            <SyncIcon />
                                        </ActionList.LeadingVisual>
                                        Re-run job
                                    </ActionList.Item>
                                </ActionList>
                            </ActionMenu.Overlay>
                        </ActionMenu>
                    </span>
                )}
            </div>
            <div className="c-sub">
                <span className="dur">{durTxt}</span>
                {runnerTxt && (
                    <span className="runner" title={"runs-on: " + runnerTxt}>
                        {runnerTxt}
                    </span>
                )}
                {queueTxt && (
                    <span className="queue" title="Queued before a runner started">
                        {queueTxt} queued
                    </span>
                )}
                {tagTxt && <Label variant="secondary">{tagTxt}</Label>}
                {ctx.show && <span className="ctx">{ctx.text}</span>}
            </div>
            {inProgress && (
                <div className="c-step">
                    <div className="sbar">
                        <motion.i
                            initial={reduce ? false : { scaleX: 0 }}
                            animate={{ scaleX: wpct / 100 }}
                            transition={reduce ? { duration: 0 } : FILL_SPRING}
                        />
                    </div>
                    <div className="lbl">{stepLabel}</div>
                </div>
            )}
        </motion.a>
    );
}
