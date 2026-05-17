/**
 * @moikapy/origen-zero — Error hierarchy
 *
 * All errors extend ZeroError for consistent catch patterns.
 */

/** Base error for all origen-zero errors. */
export class ZeroError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly diagnostics?: ZeroDiagnostic[],
  ) {
    super(message);
    this.name = "ZeroError";
  }
}

/** Thrown when the `zero` binary cannot be found on PATH or configured path. */
export class ZeroCompilerNotFoundError extends ZeroError {
  constructor(binaryPath: string) {
    super(
      `Zero CLI not found at "${binaryPath}". Install Zero CLI or configure binaryPath.`,
      "ZERO_NOT_FOUND",
    );
    this.name = "ZeroCompilerNotFoundError";
  }
}

/** Thrown when a Zero source file has diagnostic errors/warnings. */
export class ZeroCheckFailedError extends ZeroError {
  constructor(diagnostics: ZeroDiagnostic[]) {
    super(
      `Zero check failed with ${diagnostics.length} diagnostic(s):\n${diagnostics.map((d) => `  [${d.code}] ${d.severity}: ${d.message} (line ${d.line})`).join("\n")}`,
      "ZERO_CHECK_FAILED",
      diagnostics,
    );
    this.name = "ZeroCheckFailedError";
  }
}

/** Thrown when `zero build` fails (produces no output binary). */
export class ZeroBuildFailedError extends ZeroError {
  constructor(diagnostics: ZeroDiagnostic[]) {
    super(
      `Zero build failed with ${diagnostics.length} diagnostic(s)`,
      "ZERO_BUILD_FAILED",
      diagnostics,
    );
    this.name = "ZeroBuildFailedError";
  }
}

/** Thrown when a Zero CLI invocation exceeds the configured timeout. */
export class ZeroTimeoutError extends ZeroError {
  constructor(command: string, timeout: number) {
    super(
      `Zero CLI command "${command}" timed out after ${timeout}ms`,
      "ZERO_TIMEOUT",
    );
    this.name = "ZeroTimeoutError";
  }
}

/** Thrown when a compiled Zero binary returns a non-zero exit code. */
export class ZeroExecutionError extends ZeroError {
  constructor(
    public readonly exitCode: number,
    public readonly stderr: string,
  ) {
    super(
      `Zero binary exited with code ${exitCode}: ${stderr}`,
      "ZERO_EXECUTION_ERROR",
    );
    this.name = "ZeroExecutionError";
  }
}

// Re-export ZeroDiagnostic from types so consumers don't need to import both
import type { ZeroDiagnostic } from "./types.js";
export type { ZeroDiagnostic } from "./types.js";