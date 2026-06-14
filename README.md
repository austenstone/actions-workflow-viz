# actions-workflow-viz

A [GitHub Copilot CLI canvas extension](https://github.com/github/copilot-cli) that visualizes a GitHub Actions workflow run as a live job-dependency graph. Point it at a run and it renders the jobs as a DAG (edges parsed from each job's `needs:`), colored by live status, and polls the Actions API until the run completes — so you watch the run animate from queued → in_progress → completed in real time.

## What it does

- **Job DAG** — nodes are jobs, edges come from `needs:` in the workflow YAML (fetched at the run's `head_sha`).
- **Live status** — each node is colored by its current conclusion/status and re-polled while the run is in progress.
- **Matrix rollup** — matrix legs (e.g. `test (18)`, `test (20)`) roll up into their parent job node, including matrix jobs with expression `name:` values.
- **Graceful degradation** — if the YAML can't be parsed it falls back to a flat board of jobs (no edges) rather than failing.

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

| File | Purpose |
|------|---------|
| `extension.mjs` | Entry point: canvas wiring, per-instance loopback HTTP server, SSE, polling loop, `load_run`/`refresh` actions. |
| `index.html` | SVG DAG renderer + SSE client. |
| `lib/run-data.mjs` | Data layer: `gh api` calls (with transient-5xx retry), run/graph fetching, matrix mapping, status rollup. |
| `lib/parse-needs.mjs` | Dependency-free YAML extractor for `jobs.<id>.{name, needs}`. |
| `.github/workflows/demo.yml` | A rich demo pipeline (fan-out, 3-leg matrix, fan-in, conditional skip, `always()` notifier) for exercising the visualizer end-to-end. |
