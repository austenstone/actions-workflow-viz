// Minimal, dependency-free extractor for `jobs.<id>.{name,needs}` from a
// GitHub Actions workflow YAML. This is intentionally NOT a full YAML parser —
// it only understands the narrow shape we need to build the job dependency DAG:
//
//   jobs:
//     build:
//       name: Build           # optional display name
//     test:
//       needs: build          # scalar
//     lint:
//       needs: [build, test]  # flow list
//     deploy:
//       needs:                # block list
//         - test
//         - lint
//
// Matrix expansion, anchors, and expression-valued `name:` are out of scope;
// callers fall back to a flat status board when mapping is ambiguous.

function indentOf(line) {
    const m = line.match(/^(\s*)/);
    return m ? m[1].length : 0;
}

function stripComment(line) {
    // Drop full-line comments and trailing ` # ...` comments. Naive but fine
    // for the keys we care about (job ids, name, needs) which aren't quoted.
    if (/^\s*#/.test(line)) return "";
    return line.replace(/\s+#.*$/, "");
}

function parseFlowList(value) {
    // `[a, b, c]` → ["a","b","c"]
    return value
        .replace(/^\[/, "")
        .replace(/\]$/, "")
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
}

function unquote(value) {
    return value.trim().replace(/^["']|["']$/g, "");
}

export function parseJobsNeeds(yamlText) {
    const rawLines = yamlText.split(/\r?\n/);
    const lines = rawLines.map(stripComment);

    // Find the top-level `jobs:` key (indent 0).
    let jobsLine = -1;
    for (let i = 0; i < lines.length; i++) {
        if (/^jobs:\s*$/.test(lines[i])) {
            jobsLine = i;
            break;
        }
    }
    if (jobsLine === -1) return { jobs: {}, order: [] };

    // Collect the block under `jobs:` (everything indented deeper than 0 until
    // the next indent-0 non-empty line).
    const block = [];
    for (let i = jobsLine + 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === "") continue;
        if (indentOf(line) === 0) break;
        block.push(line);
    }
    if (block.length === 0) return { jobs: {}, order: [] };

    // Job-id indent = the shallowest indent in the block.
    const jobIndent = Math.min(...block.map(indentOf));

    const jobs = {};
    const order = [];
    let currentJob = null;

    for (let i = 0; i < block.length; i++) {
        const line = block[i];
        const indent = indentOf(line);

        // New job entry: `  <id>:` at job indent.
        if (indent === jobIndent) {
            const m = line.match(/^\s*([A-Za-z0-9_.-]+):\s*$/);
            if (m) {
                currentJob = m[1];
                jobs[currentJob] = { id: currentJob, name: null, needs: [] };
                order.push(currentJob);
                continue;
            }
        }

        if (!currentJob) continue;
        if (indent <= jobIndent) continue; // not inside a job body

        const trimmed = line.trim();

        // name: Foo
        const nameMatch = trimmed.match(/^name:\s*(.+)$/);
        if (nameMatch && indent === jobIndent + 2) {
            jobs[currentJob].name = unquote(nameMatch[1]);
            continue;
        }

        // needs: ...
        const needsMatch = trimmed.match(/^needs:\s*(.*)$/);
        if (needsMatch && indent === jobIndent + 2) {
            const value = needsMatch[1].trim();
            if (value === "") {
                // Block list on following lines: `- dep`
                for (let j = i + 1; j < block.length; j++) {
                    const sub = block[j];
                    if (sub.trim() === "") continue;
                    if (indentOf(sub) <= indent) break;
                    const itemMatch = sub.trim().match(/^-\s*(.+)$/);
                    if (itemMatch) jobs[currentJob].needs.push(unquote(itemMatch[1]));
                    else break;
                }
            } else if (value.startsWith("[")) {
                jobs[currentJob].needs = parseFlowList(value);
            } else {
                jobs[currentJob].needs = [unquote(value)];
            }
            continue;
        }
    }

    return { jobs, order };
}
