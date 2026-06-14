// Extract `jobs.<id>.{name, needs}` from a workflow YAML using a real YAML
// parser. This replaces the previous dependency-free regex extractor — now that
// the project has a bundler, a correct parser (handling anchors, comments,
// quoting, flow vs block lists) is cheap and far more robust. We still only read
// the narrow shape needed to build the dependency DAG; everything else is
// ignored.

import { parse as parseYaml } from "yaml";

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

function toNeeds(value: unknown): string[] {
    if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean);
    if (value == null || value === "") return [];
    return [String(value)].filter(Boolean);
}

export function parseJobsNeeds(yamlText: string): ParsedJobs {
    let doc: unknown;
    try {
        doc = parseYaml(yamlText);
    } catch {
        return EMPTY;
    }

    const jobs = (doc as { jobs?: unknown } | null)?.jobs;
    if (!jobs || typeof jobs !== "object" || Array.isArray(jobs)) return EMPTY;

    const out: Record<string, JobDef> = {};
    const order: string[] = [];

    for (const [id, raw] of Object.entries(jobs as Record<string, unknown>)) {
        const def = (raw && typeof raw === "object" ? raw : {}) as {
            name?: unknown;
            needs?: unknown;
            strategy?: unknown;
        };
        const strategy =
            def.strategy && typeof def.strategy === "object" && !Array.isArray(def.strategy)
                ? (def.strategy as { matrix?: unknown })
                : null;
        out[id] = {
            id,
            name: def.name != null ? String(def.name) : null,
            needs: toNeeds(def.needs),
            matrix: Boolean(strategy && strategy.matrix != null),
        };
        order.push(id);
    }

    return { jobs: out, order };
}
