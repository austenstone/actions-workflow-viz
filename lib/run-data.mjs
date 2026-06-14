// Live GitHub Actions run data: fetch run + jobs via the `gh` CLI, fetch the
// workflow YAML for the run's commit, and fold them into a job dependency DAG
// annotated with live status. No external deps; `gh` handles auth.

import { execFile } from "node:child_process";
import { parseJobsNeeds } from "./parse-needs.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ghOnce(args, { raw = false } = {}) {
    return new Promise((resolve, reject) => {
        execFile("gh", args, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) {
                err.message = `gh ${args.join(" ")} failed: ${stderr || err.message}`;
                err.stderr = stderr || "";
                reject(err);
                return;
            }
            if (raw) {
                resolve(stdout);
                return;
            }
            try {
                resolve(JSON.parse(stdout));
            } catch (e) {
                reject(new Error(`Could not parse gh JSON output: ${e.message}`));
            }
        });
    });
}

// GitHub's API throws transient 5xx (502/503/504) under load. Retry those a
// couple times with backoff so a single blip doesn't kill the poll.
function isTransient(err) {
    const s = String(err?.stderr || err?.message || "");
    return /HTTP 5\d\d|502|503|504|timeout|ETIMEDOUT|ECONNRESET|EAI_AGAIN/i.test(s);
}

async function gh(args, opts = {}) {
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            return await ghOnce(args, opts);
        } catch (e) {
            lastErr = e;
            if (attempt < 2 && isTransient(e)) {
                await sleep(400 * (attempt + 1));
                continue;
            }
            throw e;
        }
    }
    throw lastErr;
}

// Accepts "owner/repo" + run id, or a full run URL like
// https://github.com/owner/repo/actions/runs/123456789
export function parseRunRef({ repo, runId, runUrl }) {
    if (runUrl) {
        const m = String(runUrl).match(
            /github\.com\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)/,
        );
        if (m) return { repo: m[1], runId: Number(m[2]) };
    }
    if (repo && runId != null) {
        return { repo: String(repo), runId: Number(runId) };
    }
    throw new Error("Provide either { repo, runId } or a { runUrl }.");
}

// Normalize the GitHub job status/conclusion into a small status set the
// renderer colors by.
function nodeStatusFromLegs(legs) {
    if (legs.length === 0) return { status: "pending", conclusion: null };

    if (legs.some((l) => l.status === "in_progress")) {
        return { status: "in_progress", conclusion: null };
    }
    if (legs.some((l) => l.status === "queued" || l.status === "waiting" || l.status === "requested" || l.status === "pending")) {
        return { status: "queued", conclusion: null };
    }
    // All completed → roll up the worst conclusion.
    const order = ["failure", "timed_out", "cancelled", "action_required", "neutral", "success", "skipped"];
    let worst = "skipped";
    for (const l of legs) {
        const c = l.conclusion || "success";
        if (order.indexOf(c) < order.indexOf(worst)) worst = c;
    }
    return { status: "completed", conclusion: worst };
}

function baseName(jobName) {
    // Matrix legs look like "build (ubuntu-latest, 18)" — strip the suffix to
    // recover the base job display name.
    return jobName.replace(/\s*\(.*\)\s*$/, "").trim();
}

export async function fetchRunGraph({ repo, runId }) {
    const run = await gh([
        "api",
        `repos/${repo}/actions/runs/${runId}`,
    ]);

    const jobsResp = await gh([
        "api",
        "--paginate",
        `repos/${repo}/actions/runs/${runId}/jobs?per_page=100`,
    ]);
    const liveJobs = Array.isArray(jobsResp.jobs) ? jobsResp.jobs : [];

    // Try to recover the dependency structure from the workflow YAML at the
    // run's commit. If anything goes wrong we fall back to a flat board.
    let parsed = { jobs: {}, order: [] };
    let yamlError = null;
    if (run.path && run.head_sha) {
        try {
            const yaml = await gh(
                [
                    "api",
                    `repos/${repo}/contents/${run.path}?ref=${run.head_sha}`,
                    "-H",
                    "Accept: application/vnd.github.raw",
                ],
                { raw: true },
            );
            parsed = parseJobsNeeds(yaml);
        } catch (e) {
            yamlError = e.message;
        }
    }

    const graph = buildGraph(parsed, liveJobs);

    return {
        repo,
        runId,
        runName: run.name || run.display_title || `Run #${run.run_number}`,
        runNumber: run.run_number,
        workflowName: run.name || null,
        status: run.status, // queued | in_progress | completed
        conclusion: run.conclusion, // success | failure | ...
        event: run.event,
        headBranch: run.head_branch,
        headSha: run.head_sha ? run.head_sha.slice(0, 7) : null,
        htmlUrl: run.html_url,
        runStartedAt: run.run_started_at,
        updatedAt: run.updated_at,
        actor: run.actor?.login || run.triggering_actor?.login || null,
        nodes: graph.nodes,
        edges: graph.edges,
        flat: graph.flat,
        yamlError,
        fetchedAt: Date.now(),
    };
}

function buildGraph(parsed, liveJobs) {
    const jobIds = parsed.order;
    const hasStructure = jobIds.length > 0;

    if (!hasStructure) {
        // Flat board: one node per live job, no edges.
        const nodes = liveJobs.map((j) => {
            const { status, conclusion } = nodeStatusFromLegs([j]);
            return {
                id: String(j.id),
                label: j.name,
                status,
                conclusion,
                legs: [legOf(j)],
                startedAt: j.started_at,
                completedAt: j.completed_at,
                url: j.html_url,
            };
        });
        return { nodes, edges: [], flat: true };
    }

    // Map each YAML job id to its live legs. Match a live job to a base job by
    // exact name, by base (matrix-stripped) name, or by the raw job id.
    const displayToId = new Map();
    for (const id of jobIds) {
        const def = parsed.jobs[id];
        displayToId.set(id, id);
        if (def.name) displayToId.set(def.name, id);
    }

    const legsById = new Map(jobIds.map((id) => [id, []]));
    const unmatched = [];
    for (const j of liveJobs) {
        const candidates = [j.name, baseName(j.name)];
        let target = null;
        for (const c of candidates) {
            if (displayToId.has(c)) {
                target = displayToId.get(c);
                break;
            }
        }
        if (target) legsById.get(target).push(legOf(j));
        else unmatched.push(j);
    }

    // Common case: a single matrix job whose live legs carry an expression-based
    // `name:` (so they don't match the job id). If exactly one YAML job ended up
    // with no legs and we have orphan live jobs, they almost certainly belong to
    // it — claim them rather than scattering rootless nodes that break the edges.
    const emptyJobIds = jobIds.filter((id) => legsById.get(id).length === 0);
    if (unmatched.length > 0 && emptyJobIds.length === 1) {
        const target = emptyJobIds[0];
        for (const j of unmatched) legsById.get(target).push(legOf(j));
        unmatched.length = 0;
    }

    const nodes = jobIds.map((id) => {
        const def = parsed.jobs[id];
        const legs = legsById.get(id);
        const { status, conclusion } = nodeStatusFromLegs(legs);
        // Expression-valued `name:` (e.g. "${{ matrix.model }}") is useless as a
        // node title — fall back to the job id.
        const label = def.name && !def.name.includes("${{") ? def.name : id;
        return {
            id,
            label,
            status,
            conclusion,
            legs,
            matrix: legs.length > 1,
            startedAt: minDate(legs.map((l) => l.startedAt)),
            completedAt: maxDate(legs.map((l) => l.completedAt)),
            url: legs[0]?.url || null,
        };
    });

    // Any live job we couldn't map (e.g. expression-valued names) becomes its
    // own rootless node so nothing is silently dropped.
    for (const j of unmatched) {
        const { status, conclusion } = nodeStatusFromLegs([j]);
        nodes.push({
            id: `__live_${j.id}`,
            label: j.name,
            status,
            conclusion,
            legs: [legOf(j)],
            unmatched: true,
            startedAt: j.started_at,
            completedAt: j.completed_at,
            url: j.html_url,
        });
    }

    const nodeIds = new Set(nodes.map((n) => n.id));
    const edges = [];
    for (const id of jobIds) {
        for (const dep of parsed.jobs[id].needs) {
            if (nodeIds.has(dep)) edges.push({ from: dep, to: id });
        }
    }

    return { nodes, edges, flat: false };
}

function legOf(j) {
    return {
        name: j.name,
        status: j.status,
        conclusion: j.conclusion,
        startedAt: j.started_at,
        completedAt: j.completed_at,
        url: j.html_url,
        steps: Array.isArray(j.steps)
            ? j.steps.map((s) => ({ name: s.name, status: s.status, conclusion: s.conclusion }))
            : [],
    };
}

function minDate(dates) {
    const valid = dates.filter(Boolean).sort();
    return valid[0] || null;
}

function maxDate(dates) {
    const valid = dates.filter(Boolean).sort();
    return valid[valid.length - 1] || null;
}
