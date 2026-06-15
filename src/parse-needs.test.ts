import { describe, expect, it } from "vitest";

import { parseJobsNeeds } from "./parse-needs.js";

const wf = (jobs: string) => `on: push\njobs:\n${jobs}`;

const STEP = "    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n";

describe("parseJobsNeeds linear dependencies", () => {
    it("extracts ordered jobs and their needs", async () => {
        const yaml = wf(`  build:\n${STEP}  test:\n    needs: build\n${STEP}`);

        const { jobs, order } = await parseJobsNeeds(yaml);

        expect(order).toEqual(["build", "test"]);
        expect(jobs.build.needs).toEqual([]);
        expect(jobs.test.needs).toEqual(["build"]);
        expect(jobs.build.matrix).toBe(false);
    });
});

describe("parseJobsNeeds fan-out / fan-in", () => {
    it("captures multiple dependents and a multi-need join", async () => {
        const yaml = wf(
            `  setup:\n${STEP}` +
                `  a:\n    needs: setup\n${STEP}` +
                `  b:\n    needs: setup\n${STEP}` +
                `  deploy:\n    needs: [a, b]\n${STEP}`,
        );

        const { jobs, order } = await parseJobsNeeds(yaml);

        expect(order).toEqual(["setup", "a", "b", "deploy"]);
        expect(jobs.a.needs).toEqual(["setup"]);
        expect(jobs.b.needs).toEqual(["setup"]);
        expect(jobs.deploy.needs).toEqual(["a", "b"]);
    });
});

describe("parseJobsNeeds matrix jobs", () => {
    it("flags a matrix strategy and preserves an expression name template", async () => {
        const yaml = wf(
            `  bench:\n` +
                `    name: bench-\${{ matrix.x }}\n` +
                `    strategy:\n      matrix:\n        x: [1, 2]\n` +
                `${STEP}`,
        );

        const { jobs } = await parseJobsNeeds(yaml);

        expect(jobs.bench.matrix).toBe(true);
        expect(jobs.bench.name).toBe("bench-${{ matrix.x }}");
    });

    it("flags a dynamic (expression-valued) matrix", async () => {
        const yaml = wf(
            `  test:\n` +
                `    strategy:\n      matrix:\n        model: \${{ fromJson(needs.setup.outputs.models) }}\n` +
                `${STEP}`,
        );

        const { jobs } = await parseJobsNeeds(yaml);

        expect(jobs.test.matrix).toBe(true);
    });
});

describe("parseJobsNeeds malformed input", () => {
    it("returns an empty result instead of throwing", async () => {
        const result = await parseJobsNeeds("\t- not: valid: [");

        expect(result).toEqual({ jobs: {}, order: [] });
    });

    it("returns an empty result for a workflow with no jobs", async () => {
        const result = await parseJobsNeeds("on: push\n");

        expect(result).toEqual({ jobs: {}, order: [] });
    });
});
