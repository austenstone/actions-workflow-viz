import { useEffect, useRef, useState } from "react";
import { Terminal, type WTerm } from "@wterm/react";

interface LogTerminalProps {
    text: string;
    minRows?: number;
    maxRows?: number;
}

const NOOP = () => {};

// Size the terminal to its content: count lines, clamp between a small floor
// (so a 1-line step isn't a sliver) and a ceiling (so a huge log scrolls instead
// of pushing the page down). Trailing newline doesn't count as an extra row.
const rowsFor = (text: string, min: number, max: number): number => {
    const lines = text.replace(/\r?\n$/, "").split(/\r?\n/).length;
    return Math.min(Math.max(lines, min), max);
};

// Terminals consume raw PTY bytes, so a lone "\n" only line-feeds (no carriage
// return) and produces staircase output. Job logs are "\n"-separated, so we
// normalize to CRLF before writing.
const toCrlf = (s: string): string => s.replace(/\r?\n/g, "\r\n");

// Read-only wterm wrapper. wterm has no clear(), so we append in place while the
// new text is a superset of what we've written (the live-tail case) and remount
// the whole terminal when it diverges (search filter / leg switch).
export function LogTerminal({ text, minRows = 2, maxRows = 32 }: LogTerminalProps) {
    const term = useRef<WTerm | null>(null);
    const written = useRef("");
    const [gen, setGen] = useState(0);

    useEffect(() => {
        const prev = written.current;
        if (text === prev) return;
        if (prev && text.startsWith(prev)) {
            term.current?.write(toCrlf(text.slice(prev.length)));
            written.current = text;
        } else if (prev) {
            // Divergent (search filter / leg switch): remount; onReady rewrites.
            written.current = "";
            setGen((g) => g + 1);
        }
        // prev === "" means the terminal isn't ready yet (or just remounted);
        // onReady is the canonical initial writer, so we leave it alone here.
    }, [text]);

    return (
        <Terminal
            key={gen}
            className="logterm"
            rows={rowsFor(text, minRows, maxRows)}
            autoResize
            cursorBlink={false}
            onData={NOOP}
            onReady={(wt) => {
                term.current = wt;
                wt.write(toCrlf(text));
                written.current = text;
            }}
        />
    );
}
