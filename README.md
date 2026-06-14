# actions-workflow-viz

A [GitHub Copilot CLI canvas extension](https://github.com/github/copilot-cli) that visualizes a GitHub Actions workflow run as a live job-dependency graph. Point it at a run and it renders the jobs as a DAG (edges parsed from each job's `needs:`), colored by live status, and polls the Actions API until the run completes — so you watch the run animate from queued → in_progress → completed in real time.

## What it does

- **Job DAG** — nodes are jobs, edges come from `needs:` in the workflow YAML (fetched at the run's `head_sha`).
- **Live status** — each node is colored by its current conclusion/status and re-polled while the run is in progress.
- **Matrix rollup** — matrix legs (e.g. `test (18)`, `test (20)`) roll up into their parent job node, including matrix jobs with expression `name:` values.
- **Graceful degradation** — if the YAML can't be parsed it falls back to a flat board of jobs (no edges) rather than failing.

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
| `index.html` | SVG DAG renderer + SSE client. |
| `.github/workflows/demo.yml` | A rich demo pipeline (fan-out, 3-leg matrix, fan-in, conditional skip, `always()` notifier) for exercising the visualizer end-to-end. |
