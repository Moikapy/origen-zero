/**
 * @moikapy/origen-zero — Bridge between Origen agents and ZeroLang
 *
 * This package lets Origen agents:
 * 1. Define tools in Zero — Write .0 files, compile them, get structured diagnostics
 * 2. Register compiled Zero programs as OrigenTools
 * 3. Use Zero's compiler as interactive tools during conversations
 * 4. Self-modify — write, check, fix, and register tools in a single session
 */

// Types
export type {
  ZeroCompilerLike,
  ZeroCompilerConfig,
  ZeroHTTPCompilerConfig,
  ZeroSourceFile,
  ZeroDiagnostic,
  ZeroCheckResult,
  ZeroGraphResult,
  ZeroSizeResult,
  ZeroFixResult,
  ZeroFixSuggestion,
  ZeroBuildResult,
  ZeroBuildOptions,
  ZeroToolConfig,
  ZeroToolExecution,
  ZeroToolRegistrationSuccess,
  ZeroToolRegistrationFailure,
} from "./types.js";

// Errors
export {
  ZeroError,
  ZeroCompilerNotFoundError,
  ZeroCheckFailedError,
  ZeroBuildFailedError,
  ZeroTimeoutError,
  ZeroExecutionError,
  ZeroHTTPError,
} from "./errors.js";

// Compiler
export { ZeroCompiler } from "./compiler.js";

// HTTP Compiler
export { ZeroHTTPCompiler } from "./http-compiler.js";

// WASM Tool
export { createZeroWASMTool, createZeroWASMTools } from "./wasm-tool.js";

// Parsers (for advanced use)
export {
  parseDiagnostic,
  parseCheckOutput,
  parseGraphOutput,
  parseSizeOutput,
  parseFixOutput,
  ZeroDiagnosticSchema,
  ZeroCheckResultSchema,
  ZeroGraphResultSchema,
  ZeroSizeResultSchema,
  ZeroFixSuggestionSchema,
  ZeroFixResultSchema,
} from "./parser.js";

// Tool registration
export {
  createZeroTool,
  createZeroToolsFromProgram,
  compileAndRegister,
} from "./tools.js";

// Interactive compiler tools
export { createZeroCompilerTools } from "./compiler-tools.js";