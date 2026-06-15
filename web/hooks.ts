// React hooks for the canvas: live SSE state, a 1s wall-clock tick while a run is
// active, and the POST /action helper. These wrap the loopback server's
// /state, /events and /action endpoints (unchanged from the old vanilla client).
import { useCallback, useEffect, useState } from "react";
import type { CanvasState } from "./types";

const IDLE: CanvasState = {
    status: "idle",
    message: "Open a run to begin.",
    run: null,
    updatedAt: null,
};

// Subscribe to the server-sent run state. Seeds from /state, then streams
// /events, reconnecting with a short backoff if the stream drops.
export function useCanvasState(): CanvasState {
    const [state, setState] = useState<CanvasState>(IDLE);

    useEffect(() => {
        let es: EventSource | null = null;
        let retry: ReturnType<typeof setTimeout> | null = null;
        let closed = false;

        const connect = () => {
            try {
                es = new EventSource("/events");
            } catch {
                return;
            }
            es.onmessage = (ev) => {
                try {
                    setState(JSON.parse(ev.data) as CanvasState);
                } catch {
                    /* ignore malformed frame */
                }
            };
            es.onerror = () => {
                es?.close();
                if (!closed) retry = setTimeout(connect, 2000);
            };
        };

        fetch("/state")
            .then((r) => r.json())
            .then((s: CanvasState) => setState(s))
            .catch(() => {});
        connect();

        return () => {
            closed = true;
            if (retry) clearTimeout(retry);
            es?.close();
        };
    }, []);

    return state;
}

// A wall-clock value (ms) that advances every second while `active`, used to keep
// in-progress durations and the elapsed timer ticking between server polls. When
// inactive it settles to a single final value so completed durations stay put.
export function useNow(active: boolean): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        setNow(Date.now());
        if (!active) return;
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, [active]);
    return now;
}

export class ActionError extends Error {}

export type CallAction = (action: string, input?: unknown) => Promise<unknown>;

export function useAction(): CallAction {
    return useCallback(async (action: string, input?: unknown) => {
        const r = await fetch("/action", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action, input }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
            throw new ActionError(
                (data as { error?: string }).error || "HTTP " + r.status,
            );
        }
        return data;
    }, []);
}

// A ResizeObserver bound to an element ref that bumps a counter whenever the
// element's box changes — used by the graph to re-measure edge geometry.
export function useResizeTick(ref: React.RefObject<HTMLElement | null>): number {
    const [tick, setTick] = useState(0);
    useEffect(() => {
        const el = ref.current;
        if (!el || typeof ResizeObserver === "undefined") return;
        const ro = new ResizeObserver(() => setTick((t) => t + 1));
        ro.observe(el);
        return () => ro.disconnect();
    }, [ref]);
    return tick;
}
