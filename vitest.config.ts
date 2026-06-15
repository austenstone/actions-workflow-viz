import { defineConfig } from "vitest/config";

// Tests are co-located in src/ as *.test.ts and import production modules by
// their .js specifier (the project ships ESM with verbatimModuleSyntax). Vite's
// resolver maps those .js specifiers back to the .ts sources, so no extra
// transpile config is needed.
export default defineConfig({
    test: {
        include: ["src/**/*.test.ts", "web/**/*.test.ts"],
        // @actions/workflow-parser imports a bundled .json without an import
        // attribute, which Node's native ESM loader rejects. Inlining routes it
        // through Vite's transform pipeline (like esbuild does at build time).
        server: {
            deps: {
                inline: ["@actions/workflow-parser"],
            },
        },
    },
});
