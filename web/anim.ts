// Motion-powered animation layer for the renderer.
//
// Bundled by build.mjs (web/anim.ts → web/anim.js) and served from the loopback
// server at /anim.js, so Motion ships as a local asset — no CDN, no runtime
// node_modules. index.html imports the intent-named helpers below and the Motion
// specifics stay centralized and typed here.
//
// Why Motion instead of the old CSS keyframes: status-change pops were triggered
// by toggling a class plus a forced-reflow hack (`void el.offsetWidth`), which
// drops frames and sometimes fails to restart. Motion's animate() interrupts and
// restarts cleanly on the same element, so repeated polls never stack or stutter.

import { animate } from "motion";

const prefersReduced =
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;

// Motion commits the final transform inline. `.card` has a `:hover` transform,
// and an inline transform would win over `:hover`, so clear it once settled.
function clearTransformOnFinish(controls: { finished: Promise<unknown> }, el: HTMLElement): void {
    controls.finished.then(() => { el.style.transform = ""; }).catch(() => {});
}

// A card entering the graph for the first time. `index` staggers the initial batch.
// Motion fully owns `opacity` here (the renderer pre-hides new cards at opacity 0);
// dimming for wait/skip states is expressed via CSS `filter: opacity()`, so the
// fade never fights the resting dim level. On settle we hand `opacity` and the
// committed `transform` back to the stylesheet — clearing on interruption too, so a
// card that re-renders mid-fade can never get stranded invisible.
export function enterCard(el: HTMLElement, index = 0): void {
    if (prefersReduced) { el.style.opacity = ""; return; }
    const controls = animate(
        el,
        { opacity: [0, 1], y: [6, 0], scale: [0.975, 1] },
        { duration: 0.34, delay: Math.min(index * 0.04, 0.24), ease: [0.16, 1, 0.3, 1] },
    );
    const settle = () => { el.style.transform = ""; el.style.opacity = ""; };
    controls.finished.then(settle).catch(settle);
}

// A job changed status — spring-bounce its status glyph. The icon has no :hover
// transform, so this composes cleanly with the card's CSS hover lift.
export function flipStatus(ico: HTMLElement): void {
    if (prefersReduced) return;
    const controls = animate(
        ico,
        { scale: [1, 1.34, 1] },
        { type: "spring", stiffness: 540, damping: 16, mass: 0.7 },
    );
    clearTransformOnFinish(controls, ico);
}

// A job failed — shake its status glyph side to side. Distinct from the success
// pop (flipStatus) so a failure reads as "something's wrong" at a glance instead
// of the same celebratory bounce. x translateX composes cleanly with the card's
// CSS :hover lift; we hand the committed transform back to the stylesheet on
// settle (and on interruption) so a re-render mid-shake can't strand it offset.
export function shakeStatus(ico: HTMLElement): void {
    if (prefersReduced) return;
    const controls = animate(
        ico,
        { x: [0, -3, 3, -2.5, 2.5, -1.5, 0] },
        { duration: 0.44, ease: "easeInOut" },
    );
    clearTransformOnFinish(controls, ico);
}

// Spring a progress-bar / step-bar fill to a new width (pct: 0–100).
export function tweenWidth(el: HTMLElement, pct: number): void {
    const target = Math.max(0, Math.min(100, pct)) + "%";
    if (prefersReduced) { el.style.width = target; return; }
    animate(el, { width: target }, { type: "spring", stiffness: 210, damping: 30, mass: 0.9 });
}

// A dependency edge appearing for the first time — fade in instead of snapping.
// Edges have no dim states, so resting opacity is always 1; settle to "" on finish
// or interruption so the path is never left stranded at the inline opacity:0.
export function enterEdge(path: SVGPathElement): void {
    if (prefersReduced) { path.style.opacity = ""; return; }
    const controls = animate(path, { opacity: [0, 1] }, { duration: 0.45, ease: "easeOut" });
    const settle = () => { path.style.opacity = ""; };
    controls.finished.then(settle).catch(settle);
}

// The header status pill changed — subtle pop to draw the eye.
export function popPill(el: HTMLElement): void {
    if (prefersReduced) return;
    const controls = animate(el, { scale: [1, 1.08, 1] }, { duration: 0.4, ease: "easeOut" });
    clearTransformOnFinish(controls, el);
}
