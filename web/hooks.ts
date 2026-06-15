// Canvas client hooks — thin bindings over copilot-canvas-kit/react. The kit owns
// the loopback /state seed, the /events SSE subscription, the POST /action helper,
// and the timer/resize utilities; we only pin the shared CanvasState shape and its
// idle seed here so the rest of the UI keeps importing from one place.
import { useCanvasState as useKitCanvasState } from "copilot-canvas-kit/react";
import type { CanvasState } from "./types";

const IDLE: CanvasState = {
    status: "idle",
    message: "Open a run to begin.",
    run: null,
    updatedAt: null,
    picker: null,
};

export const useCanvasState = (): CanvasState => useKitCanvasState<CanvasState>(IDLE);

export { useAction, useNow, useResizeTick, ActionError } from "copilot-canvas-kit/react";
