import type { CanvasState } from "../types";

// The full-surface state screen shown when there's no run to render: idle,
// loading (with spinner), or error. Mirrors the old #overlay markup.
export function Overlay({ state }: { state: CanvasState }) {
    let title: string;
    let spin = false;
    if (state.status === "loading") {
        title = "Loading run…";
        spin = true;
    } else if (state.status === "error") {
        title = "Couldn't load run";
    } else {
        title = "No run loaded";
    }
    const msg =
        state.message ||
        (state.status === "idle"
            ? "Use the load_run action to point this at a run."
            : "");

    return (
        <div className="overlay">
            {spin && <div className="spin" />}
            <div className="big">{title}</div>
            {msg && <div>{msg}</div>}
        </div>
    );
}
