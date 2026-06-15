// Cached Octokit client. Auth comes from GITHUB_TOKEN / GH_TOKEN, falling back
// to the `gh` CLI's stored token so it "just works" in a dev environment that
// already has gh authenticated. The retry plugin transparently re-issues calls
// on transient 5xx / rate-limit responses, replacing the hand-rolled retry loop
// the old gh-shelling layer carried.

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
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

function repoFromRemote(url: string): string | null {
    const m = url.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/);
    return m ? m[1] : null;
}

// The extension host runs with cwd set to ~/.copilot, NOT the user's project, so
// shelling out to gh/git self-detects the wrong repo. The host does pass SESSION_ID,
// and the desktop app writes the real project metadata to
// ~/.copilot/session-state/<id>/workspace.yaml, so read the repo from there first.
async function repoFromSession(): Promise<string | null> {
    const sessionId = process.env.SESSION_ID;
    if (!sessionId) return null;
    const path = join(homedir(), ".copilot", "session-state", sessionId, "workspace.yaml");
    try {
        const text = await readFile(path, "utf8");
        const m = text.match(/^repository:\s*(\S+)\s*$/m);
        const slug = m?.[1];
        return slug && slug.includes("/") ? slug : null;
    } catch {
        return null;
    }
}

// Best-effort "what repo am I in" for the no-input picker. Prefers the session's
// recorded project, then asks gh (honors the active gh context), then the origin remote.
export async function detectRepo(): Promise<string | null> {
    const fromSession = await repoFromSession();
    if (fromSession) return fromSession;
    try {
        const { stdout } = await pExecFile(
            "gh",
            ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
            { timeout: 5000 },
        );
        const slug = stdout.trim();
        if (slug.includes("/")) return slug;
    } catch {
        /* fall through to git remote */
    }
    try {
        const { stdout } = await pExecFile("git", ["remote", "get-url", "origin"], {
            timeout: 5000,
        });
        return repoFromRemote(stdout.trim());
    } catch {
        return null;
    }
}
