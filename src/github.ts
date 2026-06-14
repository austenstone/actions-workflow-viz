// Cached Octokit client. Auth comes from GITHUB_TOKEN / GH_TOKEN, falling back
// to the `gh` CLI's stored token so it "just works" in a dev environment that
// already has gh authenticated. The retry plugin transparently re-issues calls
// on transient 5xx / rate-limit responses, replacing the hand-rolled retry loop
// the old gh-shelling layer carried.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { Octokit } from "@octokit/rest";
import { retry } from "@octokit/plugin-retry";

const pExecFile = promisify(execFile);

const RetryingOctokit = Octokit.plugin(retry);

let clientPromise: Promise<Octokit> | null = null;

async function resolveToken(): Promise<string | undefined> {
    const env = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (env) return env;
    try {
        const { stdout } = await pExecFile("gh", ["auth", "token"], { timeout: 5000 });
        const token = stdout.trim();
        return token || undefined;
    } catch {
        return undefined;
    }
}

export function getOctokit(): Promise<Octokit> {
    if (!clientPromise) {
        clientPromise = (async () => {
            const auth = await resolveToken();
            return new RetryingOctokit({
                auth,
                userAgent: "actions-workflow-viz",
                request: { retries: 3, retryAfter: 1 },
            });
        })();
    }
    return clientPromise;
}
