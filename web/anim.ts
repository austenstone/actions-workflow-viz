// Motion-powered animation layer for the renderer, built on the React API
// (`motion/react`) rather than the standalone imperative `animate()`.
//
// Enter/state animations live as declarative `<motion.* />` props directly in the
// components (card lift, edge fade, progress fill). This module holds the shared
// transition presets so the timing stays centralized and typed, plus one hook —
// `useChangeFx` — for the fire-and-forget glyph/pill pops.
//
// Why a hook for the pops: a pop is a keyframe burst that returns to rest
// (1 → 1.34 → 1), not an A→B state change, so it doesn't map onto a declarative
// `animate` target — the target never changes, so Motion would never replay it.
// `useAnimate()` is Motion's React-native tool for exactly this: a scoped,
// ref-safe trigger that interrupts and restarts cleanly on every status change.
//
// Reduced motion is read via Motion's `useReducedMotion()` hook (reactive — it
// updates if the OS setting changes mid-session), replacing the old module-load
// matchMedia snapshot.

import { useEffect, useRef } from "react";
import { useAnimate, useReducedMotion } from "motion/react";
import type { DOMKeyframesDefinition, AnimationOptions } from "motion/react";

// Card enter: fade + rise + scale. `enterDelay` staggers the initial batch.
export const ENTER_TRANSITION: AnimationOptions = {
    duration: 0.34,
    ease: [0.16, 1, 0.3, 1],
};
export const enterDelay = (index: number): number => Math.min(index * 0.04, 0.24);

// Success: spring-bounce pop. Failure: side-to-side shake (reads as "wrong" at a
// glance instead of the celebratory bounce).
export const POP: AnimationOptions = { type: "spring", stiffness: 540, damping: 16, mass: 0.7 };
export const SHAKE: AnimationOptions = { duration: 0.44, ease: "easeInOut" };
export const POP_KEYS: DOMKeyframesDefinition = { scale: [1, 1.34, 1] };
export const SHAKE_KEYS: DOMKeyframesDefinition = { x: [0, -3, 3, -2.5, 2.5, -1.5, 0] };

// Header status pill: subtle pop to draw the eye on a status change.
export const PILL_POP: AnimationOptions = { duration: 0.4, ease: "easeOut" };
export const PILL_POP_KEYS: DOMKeyframesDefinition = { scale: [1, 1.08, 1] };

// Progress / step bar fill: spring to the new width.
export const WIDTH_SPRING: AnimationOptions = {
    type: "spring",
    stiffness: 210,
    damping: 30,
    mass: 0.9,
};

// Dependency edge appearing for the first time: fade in instead of snapping.
export const EDGE_FADE: AnimationOptions = { duration: 0.45, ease: "easeOut" };

// Fire a one-shot keyframe burst on an element whenever `value` changes — but not
// on first render, and never under reduced motion. `build` maps the new value to
// the keyframes + transition to play (return null to skip). Attach the returned
// ref to the element you want to animate.
export function useChangeFx<T extends Element = HTMLElement>(
    value: string,
    build: (next: string) => { keys: DOMKeyframesDefinition; transition: AnimationOptions } | null,
) {
    const [scope, animate] = useAnimate<T>();
    const reduce = useReducedMotion();
    const prev = useRef<string | undefined>(undefined);

    useEffect(() => {
        const was = prev.current;
        prev.current = value;
        if (!was || was === value || reduce || !scope.current) return;
        const fx = build(value);
        if (fx) animate(scope.current, fx.keys, fx.transition);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    return scope;
}
