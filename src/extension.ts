// CLI entry point. The canvas (state shape, assets, action handlers, loopback
// host) lives in src/canvas.ts so it can be reused without the Copilot SDK —
// see dev.mjs, which opens an instance to serve the same app as a plain
// webpage. Here we only join the live session and forward the session-bound
// logging + attachment hooks into the canvas.

import { joinSession, type CopilotSession } from "@github/copilot-sdk/extension";

import { bindSession, canvas } from "./canvas.js";

const session: CopilotSession = await joinSession({ canvases: [canvas] });

bindSession(
    (message, opts) => {
        try {
            session.log(message, opts);
        } catch {
            /* logging is best-effort */
        }
    },
    (params) => session.rpc.extensions.sendAttachmentsToMessage(params),
);
