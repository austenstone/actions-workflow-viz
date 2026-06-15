// Minimal ambient declarations for the subset of `@github/copilot-sdk/extension`
// this extension uses. The real module is auto-resolved by the Copilot CLI at
// runtime (and marked external in build.mjs), so it is never installed into
// node_modules. These types exist only to let `tsc --noEmit` type-check the
// source against an accurate-enough surface without depending on an absolute
// install path that varies per machine.

// The canvas type is owned by copilot-canvas-kit now; `host.toCanvas()` produces
// it and `joinSession` consumes it, so we re-use the kit's `Canvas` shape here
// instead of maintaining a parallel (and previously stale) declaration.
import type { Canvas } from "copilot-canvas-kit";

declare module "@github/copilot-sdk/extension" {
    export interface LogOptions {
        level?: "info" | "warn" | "error" | "debug";
        ephemeral?: boolean;
    }

    export type MessageAttachment =
        | { type: "file"; path: string; displayName?: string }
        | { type: "directory"; path: string; displayName?: string }
        | { type: "blob"; data: string; mimeType: string; displayName?: string };

    export interface MessageOptions {
        prompt: string;
        attachments?: MessageAttachment[];
        mode?: "enqueue" | "immediate";
        agentMode?: "interactive" | "plan" | "autopilot" | "shell";
        requestHeaders?: Record<string, string>;
        displayPrompt?: string;
    }

    export interface ExtensionContextPushInput {
        type: "extension_context";
        title: string;
        payload: { [k: string]: unknown };
    }

    export interface SendAttachmentsToMessageParams {
        instanceId?: string;
        attachments: ExtensionContextPushInput[];
    }

    export interface SessionRpc {
        extensions: {
            sendAttachmentsToMessage(params: SendAttachmentsToMessageParams): Promise<void>;
        };
    }

    export interface CopilotSession {
        sessionId: string;
        workspacePath?: string;
        log(message: string, opts?: LogOptions): void;
        send(prompt: string): Promise<string>;
        send(options: MessageOptions): Promise<string>;
        readonly rpc: SessionRpc;
    }

    export interface JoinSessionConfig {
        canvases?: Canvas[];
    }

    export function joinSession(config: JoinSessionConfig): Promise<CopilotSession>;
}
