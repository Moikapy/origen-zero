/**
 * @moikapy/origen-zero — Type definitions
 *
 * All TypeScript interfaces and types for the ZeroLang → Origen bridge.
 */

// ── Compiler Configuration ──────────────────────────────────────────────

/** Configuration for the ZeroCompiler class. */
export interface ZeroCompilerConfig {
  /** Path to zero CLI binary. Default: "zero" (must be on PATH) */
  binaryPath?: string;
  /** Working directory for compilation. Default: process.cwd() */
  workingDir?: string;
  /** Timeout for compiler invocations in ms. Default: 30000 */
  timeout?: number;
}

/** A Zero source file: either a path on disk or inline content. */
export interface ZeroSourceFile {
  /** File path (relative to workingDir). Used for error reporting. */
  path: string;
  /** Source content. If omitted, reads from disk at path. */
  content?: string;
}

// ── Compiler Output Types ───────────────────────────────────────────────

/** A single diagnostic from the Zero compiler. */
export interface ZeroDiagnostic {
  /** Machine-readable code, e.g. "NAM003", "TYP001" */
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  line: number;
  column?: number;
  /** Repair metadata — structured suggestion from the compiler */
  repair?: {
    id: string;
    suggestion?: string;
  };
}

/** Result of `zero check --json`. */
export interface ZeroCheckResult {
  ok: boolean;
  diagnostics: ZeroDiagnostic[];
  /** Raw JSON output from zero check --json */
  raw: Record<string, unknown>;
}

/** Result of `zero graph --json`. */
export interface ZeroGraphResult {
  ok: boolean;
  /** Dependency graph as adjacency list */
  graph: Record<string, string[]>;
  raw: Record<string, unknown>;
}

/** Result of `zero size --json`. */
export interface ZeroSizeResult {
  ok: boolean;
  /** Size report — function sizes, total binary size estimate */
  sizes: Record<string, number>;
  raw: Record<string, unknown>;
}

/** Result of `zero fix --plan --json`. */
export interface ZeroFixResult {
  ok: boolean;
  fixes: ZeroFixSuggestion[];
  raw: Record<string, unknown>;
}

/** A single repair suggestion from `zero fix --plan --json`. */
export interface ZeroFixSuggestion {
  code: string;
  line: number;
  message: string;
  suggestion?: string;
}

/** Result of `zero build`. */
export interface ZeroBuildResult {
  ok: boolean;
  /** Path to compiled output */
  outputPath?: string;
  diagnostics: ZeroDiagnostic[];
}

/** Options for `zero build`. */
export interface ZeroBuildOptions {
  /** Output path for compiled binary. */
  out?: string;
  /** Target triple, e.g., "linux-musl-x64". */
  target?: string;
  /** Emit format: "exe" (default) or "object". */
  emit?: "exe" | "object";
}

// ── Tool Registration Types ─────────────────────────────────────────────

/** Configuration for registering a Zero function as an OrigenTool. */
export interface ZeroToolConfig {
  /** The Zero function to expose as a tool. */
  functionName: string;
  /** Human-readable description for the LLM. Required. */
  description: string;
  /** Path to the compiled Zero executable. */
  executablePath: string;
  /** Zero CLI config for verification before registration. */
  compiler?: ZeroCompilerConfig;
  /** Whether to verify the tool compiles cleanly before registering. Default: true */
  verify?: boolean;
}

/** Result of compileAndRegister on success. */
export interface ZeroToolRegistrationSuccess {
  tools: unknown[];
}

/** Result of compileAndRegister on failure. */
export interface ZeroToolRegistrationFailure {
  errors: ZeroDiagnostic[];
}