/**
 * @moikapy/origen-zero — Type definitions
 *
 * All TypeScript interfaces and types for the ZeroLang → Origen bridge.
 */

// ── Compiler Interface ───────────────────────────────────────────────────

/**
 * The compiler interface. Both CLI and HTTP implementations satisfy this.
 * Use ZeroCompiler for Node/Bun (subprocess), ZeroHTTPCompiler for
 * Cloudflare Workers (HTTP fetch to a Zero service).
 */
export interface ZeroCompilerLike {
  check(source: string | ZeroSourceFile): Promise<ZeroCheckResult>;
  graph(source: string | ZeroSourceFile): Promise<ZeroGraphResult>;
  size(source: string | ZeroSourceFile): Promise<ZeroSizeResult>;
  fix(source: string | ZeroSourceFile): Promise<ZeroFixResult>;
  build(source: string | ZeroSourceFile, options?: ZeroBuildOptions): Promise<ZeroBuildResult>;
  explain(diagnosticCode: string): Promise<string>;
}

// ── Compiler Configuration ──────────────────────────────────────────────

/** Configuration for the local ZeroCompiler (subprocess-based). */
export interface ZeroCompilerConfig {
  /** Path to zero CLI binary. Default: "zero" (must be on PATH) */
  binaryPath?: string;
  /** Working directory for compilation. Default: process.cwd() */
  workingDir?: string;
  /** Timeout for compiler invocations in ms. Default: 30000 */
  timeout?: number;
}

/** Configuration for ZeroHTTPCompiler (fetch-based, works in Workers). */
export interface ZeroHTTPCompilerConfig {
  /** Base URL of the Zero compiler service. Required. */
  endpoint: string;
  /** Authorization header value (e.g., "Bearer <token>"). Optional. */
  apiKey?: string;
  /** Custom headers to include in every request. Optional. */
  headers?: Record<string, string>;
  /** Timeout for HTTP requests in ms. Default: 30000 */
  timeout?: number;
  /** Custom fetch function. Defaults to globalThis.fetch. Useful for testing. */
  fetch?: typeof globalThis.fetch;
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
  /** Parsed symbol list from the graph output. */
  symbols: ZeroGraphSymbol[];
  /** Parsed function list from the graph output. */
  functions: ZeroGraphFunction[];
  /** Raw JSON output from zero graph. */
  raw: Record<string, unknown>;
}

export interface ZeroGraphSymbol {
  name: string;
  module: string;
  kind: string;
  public: boolean;
  effects: string[];
}

export interface ZeroGraphFunction {
  name: string;
  kind: string;
  public: boolean;
  params: number;
  returnType: string;
  raises: boolean;
  effects: string[];
  allocationBehavior: string;
  targetSupport: { status: string; missingCapabilities: string[] };
}

/** Result of `zero size --json`. */
export interface ZeroSizeResult {
  ok: boolean;
  /** Structured size/runtime analysis from the real CLI. */
  portableRuntime?: ZeroPortableRuntime;
  /** Raw JSON output from zero size. */
  raw: Record<string, unknown>;
}

export interface ZeroPortableRuntime {
  target: string;
  runtimeKind: string;
  portable: boolean;
  imports: { functionCount: number; functions: string[]; module: string | null };
  memoryFloor?: { floorBytes: number; minimumPages: number };
  capabilityRestrictions?: { filesystem?: string };
}

/** Result of `zero fix --plan --json`. */
export interface ZeroFixResult {
  ok: boolean;
  fixes: ZeroFixSuggestion[];
  raw: Record<string, unknown>;
}

/** A single repair suggestion from `zero fix --plan --json`. */
export interface ZeroFixSuggestion {
  /** Fix identifier, e.g. "repair-syntax". */
  id: string;
  /** Associated diagnostic code, e.g. "PAR100". */
  diagnosticCode: string;
  /** Safety level: "safe" | "requires-human-review". */
  safety: string;
  /** Human-readable summary of the fix. */
  summary: string;
  /** Whether the fix can be applied automatically. */
  appliesEdits: boolean;
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
  /** Output path for compiled binary/wasm. */
  out?: string;
  /** Target triple, e.g., "linux-musl-x64" or "wasm32-web". */
  target?: string;
  /** Emit format: "exe" (default), "object", or "wasm". */
  emit?: "exe" | "object" | "wasm";
}

// ── Tool Registration Types ─────────────────────────────────────────────

/** Configuration for registering a Zero function as an OrigenTool. */
export interface ZeroToolConfig {
  /** The Zero function to expose as a tool. */
  functionName: string;
  /** Human-readable description for the LLM. Required. */
  description: string;
  /** Execution mode for the compiled Zero program. */
  execution: ZeroToolExecution;
  /** Custom parameter schema for the OrigenTool. */
  parameters?: Record<string, unknown>;
  /** Origen-compatible Zod inputSchema. */
  inputSchema?: unknown;
  /** Zero compiler for verification before registration. Optional. */
  compiler?: ZeroCompilerLike;
  /** Whether to verify the tool compiles cleanly before registering. Default: true */
  verify?: boolean;
}

/** How a Zero tool executes. Exactly one mode must be set. */
export type ZeroToolExecution =
  | { mode: "subprocess"; executablePath: string }
  | { mode: "http"; endpoint: string; apiKey?: string; headers?: Record<string, string>; fetch?: typeof globalThis.fetch }
  | { mode: "wasm"; wasmBytes: ArrayBuffer | WebAssembly.Module }

/** Result of compileAndRegister on success. */
export interface ZeroToolRegistrationSuccess {
  tools: unknown[];
}

/** Result of compileAndRegister on failure. */
export interface ZeroToolRegistrationFailure {
  errors: ZeroDiagnostic[];
}