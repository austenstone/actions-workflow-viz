# actions-workflow-viz

A [GitHub Copilot CLI canvas extension](https://github.com/github/copilot-cli) that visualizes a GitHub Actions workflow run as a live job-dependency graph. Point it at a run and it renders the jobs as a DAG (edges parsed from each job's `needs:`), colored by live status, and polls the Actions API until the run completes — so you watch the run animate from queued → in_progress → completed in real time.

## What it does

- **Job DAG** — nodes are jobs, edges come from `needs:` in the workflow YAML (fetched at the run's `head_sha`).
- **Live status** — each node is colored by its current conclusion/status and re-polled while the run is in progress.
- **Matrix rollup** — matrix legs (e.g. `test (18)`, `test (20)`) roll up into their parent job node, including matrix jobs with expression `name:` values.
- **Graceful degradation** — if the YAML can't be parsed it falls back to a flat board of jobs (no edges) rather than failing.

## Live logs & the step-event feed

Click a job node to open its logs. Two things happen depending on whether the job is still running:

- **While the job runs** — a **live step-event feed** streams what's happening *now*: completed steps land as finalized lines (timestamp + duration), the running step ticks live with a pulsing indicator, and queued steps trail with a count. This is synthesized from the per-step status + timing the jobs API reports in real time (polled at 1.2s).
- **On completion** — the feed swaps to the real per-step logs, bucketed by step and tailed in place.

**Why not just stream the raw log text?** Because you can't. GitHub only publishes the REST job-log blob when the *whole job completes* — while a job is in progress, `GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs` returns `404 BlobNotFound`. There is no token- or PAT-accessible endpoint for live in-progress log *text*; the web UI's live tail rides a cookie-authenticated WebSocket that an extension can't reach. [vscode-github-actions](https://github.com/github/vscode-github-actions) doesn't stream either — it does a one-shot fetch on completion. The step-event feed is how we surface live progress within that hard constraint.


## Inspiration

The workflow parsing borrows from [github/vscode-github-actions](https://github.com/github/vscode-github-actions). Rather than hand-rolling a YAML walk, this extension uses GitHub's official [`@actions/workflow-parser`](https://github.com/actions/languageservices) (the same engine behind that extension's language server) to read the job graph, giving it schema awareness and expression handling for free.


## Install

This is a user-scope extension. Drop the folder into `~/.copilot/extensions/actions-workflow-viz/` (or install it from a gist via the Copilot CLI), then reload extensions. It requires the `gh` CLI to be authenticated with `repo` + `workflow` scopes — all GitHub API calls go through `gh api`.

## Usage

Open the canvas and load a run with either a `{ repo, runId }` pair or a full run URL:

```
load_run  { "repo": "owner/name", "runId": 123456789 }
load_run  { "runUrl": "https://github.com/owner/name/actions/runs/123456789" }
refresh   {}
```

## Files

TypeScript in `src/` and `web/` is bundled by `build.mjs` (esbuild) into `extension.mjs` and `web/anim.js`.

| File | Purpose |
|------|---------|
| `src/extension.ts` | Entry point: canvas wiring, per-instance loopback HTTP server, SSE, polling loop, `load_run`/`refresh` actions. Bundled to `extension.mjs`. |
| `src/run-data.ts` | Data layer: Octokit calls, run/graph fetching, matrix mapping, status rollup. |
| `src/parse-needs.ts` | Reads `jobs.<id>.{name, needs, matrix}` via `@actions/workflow-parser` to build the DAG. |
| `src/github.ts` | Octokit client backed by the authenticated `gh` token. |
| `src/types.ts` | Shared graph/envelope types consumed by `index.html`. |
| `web/anim.ts` | Canvas-side animation helpers. Bundled to `web/anim.js`. |
| `web/components/StepActivityFeed.tsx` | Live step-event feed: synthesizes a streaming activity log from per-step transitions while a job runs. |
| `index.html` | SVG DAG renderer + SSE client. |
| `.github/workflows/demo.yml` | A rich demo pipeline (fan-out, 3-leg matrix, fan-in, conditional skip, `always()` notifier) for exercising the visualizer end-to-end. |
