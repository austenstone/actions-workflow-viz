// Minimal ambient declarations for the subset of `@github/copilot-sdk/extension`
// this extension uses. The real module is auto-resolved by the Copilot CLI at
// runtime (and marked external in build.mjs), so it is never installed into
// node_modules. These types exist only to let `tsc --noEmit` type-check the
// source against an accurate-enough surface without depending on an absolute
// install path that varies per machine.

declare module "@github/copilot-sdk/extension" {
    export class CanvasError extends Error {
        constructor(code: string, message: string);
        code: string;
    }

    export interface CanvasOpenContext<I = unknown> {
        sessionId: string;
        extensionId: string;
        canvasId: string;
        instanceId: string;
        input?: I;
    }

    export interface CanvasActionContext<I = unknown> {
        sessionId: string;
        extensionId: string;
        canvasId: string;
        instanceId: string;
        actionName: string;
        input?: I;
    }

    export interface CanvasCloseContext {
        sessionId: string;
        extensionId: string;
        canvasId: string;
        instanceId: string;
    }

    export interface CanvasOpenResult {
        url?: string;
        title?: string;
        status?: string;
    }

    export interface CanvasActionDeclaration<I = unknown, R = unknown> {
        name: string;
        description?: string;
        inputSchema?: unknown;
        handler: (ctx: CanvasActionContext<I>) => R | Promise<R>;
    }

    export interface CanvasDeclaration {
        id: string;
        displayName?: string;
        description?: string;
        inputSchema?: unknown;
        actions?: CanvasActionDeclaration[];
        open: (ctx: CanvasOpenContext) => CanvasOpenResult | Promise<CanvasOpenResult>;
        onClose?: (ctx: CanvasCloseContext) => void | Promise<void>;
    }

    export function createCanvas(declaration: CanvasDeclaration): CanvasDeclaration;

    export interface LogOptions {
        level?: "info" | "warn" | "error" | "debug";
        ephemeral?: boolean;
    }

    export interface CopilotSession {
        sessionId: string;
        workspacePath?: string;
        log(message: string, opts?: LogOptions): void;
    }

    export interface JoinSessionConfig {
        canvases?: CanvasDeclaration[];
    }

    export function joinSession(config: JoinSessionConfig): Promise<CopilotSession>;
}
