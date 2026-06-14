// Extract `jobs.<id>.{name, needs, matrix}` from a workflow YAML using GitHub's
// official `@actions/workflow-parser` (the same engine behind the
// github/vscode-github-actions language server). It gives us schema-aware
// parsing and expression awareness instead of a hand-rolled YAML walk. We still
// read only the narrow shape needed to build the dependency DAG; everything else
// is ignored.

import {
    convertWorkflowTemplate,
    isBasicExpression,
    isMapping,
    isString,
    NoOperationTraceWriter,
    parseWorkflow,
} from "@actions/workflow-parser";
import { ErrorPolicy } from "@actions/workflow-parser/model/convert";
import type { ScalarToken } from "@actions/workflow-parser/templates/tokens/scalar-token";

export interface JobDef {
    id: string;
    name: string | null;
    needs: string[];
    // True when the job declares a `strategy.matrix` — including dynamic matrices
    // whose value is an expression (e.g. `${{ fromJson(...) }}`). Used to fold
    // expression-named live legs back into their parent job node.
    matrix: boolean;
}

export interface ParsedJobs {
    jobs: Record<string, JobDef>;
    order: string[];
}

const EMPTY: ParsedJobs = { jobs: {}, order: [] };

// A job name can be a literal string or an expression template. For the DAG we
// want the raw source either way: `isString` yields the plain text, while a
// `BasicExpressionToken` exposes `.source` preserving the original template
// (e.g. `bench-${{ matrix.x }}`) so the renderer's prefix-matching still works.
function jobName(token: ScalarToken | undefined): string | null {
    if (!token) return null;
    if (isString(token)) return token.value;
    if (isBasicExpression(token)) return token.source ?? token.toString();
    return token.toString();
}

export async function parseJobsNeeds(yamlText: string): Promise<ParsedJobs> {
    try {
        const { context, value } = parseWorkflow(
            { name: "workflow.yml", content: yamlText },
            new NoOperationTraceWriter(),
        );
        if (!value) return EMPTY;

        const template = await convertWorkflowTemplate(context, value, undefined, {
            errorPolicy: ErrorPolicy.TryConversion,
        });

        const out: Record<string, JobDef> = {};
        const order: string[] = [];
        for (const job of template.jobs) {
            const id = job.id.value;
            const strategy = job.strategy;
            out[id] = {
                id,
                name: jobName(job.name),
                needs: (job.needs ?? []).map((n) => n.value),
                matrix: Boolean(strategy && isMapping(strategy) && strategy.find("matrix") !== undefined),
            };
            order.push(id);
        }
        return { jobs: out, order };
    } catch {
        return EMPTY;
    }
}
