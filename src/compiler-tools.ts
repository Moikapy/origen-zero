/**
 * @moikapy/origen-zero — Interactive compiler tools
 *
 * Creates four OrigenTools that let the LLM write, check, and fix
 * Zero programs during a conversation:
 *   - zero_check: Check a Zero program for errors
 *   - zero_graph: Get the dependency graph
 *   - zero_size: Get size estimates for functions
 *   - zero_fix: Plan repairs for a Zero program
 */

import type { OrigenTool } from "@moikapy/origen";
import { ZeroCompiler } from "./compiler.js";
import type { ZeroCompilerConfig } from "./types.js";

const TEMP_DIR = ".zero-origen/tmp";

/**
 * Create the set of interactive Zero compiler tools that let the LLM
 * write, check, and fix Zero programs during a conversation.
 */
export function createZeroCompilerTools(
  compiler?: ZeroCompilerConfig,
): OrigenTool[] {
  const zero = new ZeroCompiler(compiler);

  const checkTool: OrigenTool = {
    name: "zero_check",
    description: `Check a Zero program for errors. Returns structured diagnostics with repair suggestions. Write your Zero source code in the "source" parameter.`,
    parameters: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "Zero source code to check",
        },
        path: {
          type: "string",
          description: "File path hint for error reporting (optional)",
        },
      },
      required: ["source"],
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const source = String(args.source ?? "");
      const path = args.path ? String(args.path) : undefined;
      const result = await zero.check(path ? { path, content: source } : source);

      if (result.ok) {
        return "✅ Zero program checks passed with no errors.";
      }

      const lines = result.diagnostics.map((d) => {
        let line = `[${d.code}] ${d.severity}: ${d.message}`;
        if (d.line) line += ` (line ${d.line})`;
        if (d.column) line += `:${d.column}`;
        if (d.repair) line += ` → Fix: ${d.repair.suggestion ?? d.repair.id}`;
        return line;
      });

      return `❌ Zero program has ${result.diagnostics.length} diagnostic(s):\n${lines.join("\n")}`;
    },
  };

  const graphTool: OrigenTool = {
    name: "zero_graph",
    description: `Get the dependency graph of a Zero program. Shows which functions depend on which other functions.`,
    parameters: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "Zero source code to analyze",
        },
        path: {
          type: "string",
          description: "File path hint (optional)",
        },
      },
      required: ["source"],
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const source = String(args.source ?? "");
      const path = args.path ? String(args.path) : undefined;
      const result = await zero.graph(path ? { path, content: source } : source);
      return JSON.stringify(result.graph, null, 2);
    },
  };

  const sizeTool: OrigenTool = {
    name: "zero_size",
    description: `Get size estimates for functions in a Zero program. Returns estimated binary size per function.`,
    parameters: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "Zero source code to size-report",
        },
        path: {
          type: "string",
          description: "File path hint (optional)",
        },
      },
      required: ["source"],
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const source = String(args.source ?? "");
      const path = args.path ? String(args.path) : undefined;
      const result = await zero.size(path ? { path, content: source } : source);
      return JSON.stringify(result.sizes, null, 2);
    },
  };

  const fixTool: OrigenTool = {
    name: "zero_fix",
    description: `Plan repairs for a Zero program. Returns suggested fixes with line numbers and descriptions. Use this after zero_check reports errors.`,
    parameters: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "Zero source code to repair",
        },
        path: {
          type: "string",
          description: "File path hint (optional)",
        },
      },
      required: ["source"],
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const source = String(args.source ?? "");
      const path = args.path ? String(args.path) : undefined;
      const result = await zero.fix(path ? { path, content: source } : source);

      if (result.ok && result.fixes.length === 0) {
        return "✅ No fixes needed — program is clean.";
      }

      const lines = result.fixes.map((f) => {
        let line = `[${f.code}] Line ${f.line}: ${f.message}`;
        if (f.suggestion) line += `\n  Suggestion: ${f.suggestion}`;
        return line;
      });

      return `📝 ${result.fixes.length} fix suggestion(s):\n${lines.join("\n")}`;
    },
  };

  return [checkTool, graphTool, sizeTool, fixTool];
}