import type { SyntheticEvent } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ActionBar } from "@primer/react/experimental";
import { SyncIcon } from "@primer/octicons-react";
import type { GraphNode } from "../types";
import {
    durOf,
    legProgress,
    RERUNNABLE_CLS,
    statusOf,
    stepProgress,
} from "../format";
import { enterCard, flipStatus, shakeStatus, tweenWidth } from "../anim";
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
    const cardRef = useRef<HTMLAnchorElement | null>(null);
    const icoRef = useRef<HTMLSpanElement>(null);
    const fillRef = useRef<HTMLElement>(null);
    const prevCls = useRef<string | undefined>(undefined);

    const st = statusOf(node);
    const lp = legProgress(node);
    const inProgress = node.status === "in_progress";
    const canRerun = runCompleted && RERUNNABLE_CLS.includes(st.cls);

    const setCardRef = useCallback(
        (el: HTMLAnchorElement | null) => {
            cardRef.current = el;
            registerCard(node.id, el);
        },
        [node.id, registerCard],
    );

    // Enter animation, once, before paint so there's no flash at full opacity.
    useLayoutEffect(() => {
        if (cardRef.current) enterCard(cardRef.current, index);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Pop (or shake, on failure) the glyph when the status class changes.
    useEffect(() => {
        const was = prevCls.current;
        if (was && was !== st.cls && icoRef.current) {
            (st.cls === "fail" ? shakeStatus : flipStatus)(icoRef.current);
        }
        prevCls.current = st.cls;
    }, [st.cls]);

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

    useEffect(() => {
        if (inProgress && fillRef.current) tweenWidth(fillRef.current, wpct);
    }, [wpct, inProgress]);

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

    const mtxTxt = node.legs.length ? `matrix · ${node.legs.length}` : "matrix";
    const mtxTip = node.legs.length
        ? node.legs.map((l) => `${l.name} — ${l.conclusion || l.status}`).join("\n")
        : "waiting for matrix legs…";

    return (
        // eslint-disable-next-line jsx-a11y/anchor-is-valid
        <a
            ref={setCardRef}
            className={"card s-" + st.cls}
            data-id={node.id}
            role="button"
            tabIndex={0}
            onClick={onActivate}
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
                    <ActionBar className="rerun-bar" size="small" aria-label={"Actions for " + node.label}>
                        <ActionBar.IconButton
                            icon={SyncIcon}
                            aria-label={"Re-run job " + node.label}
                            loading={rerunBusy}
                            onClick={fireRerun}
                        />
                    </ActionBar>
                )}
            </div>
            <div className="c-sub">
                <span className="dur">{durTxt}</span>
                {tagTxt && <span className="tag">{tagTxt}</span>}
                {ctx.show && <span className="ctx">{ctx.text}</span>}
            </div>
            {inProgress && (
                <div className="c-step">
                    <div className="sbar">
                        <i ref={fillRef} />
                    </div>
                    <div className="lbl">{stepLabel}</div>
                </div>
            )}
        </a>
    );
}
