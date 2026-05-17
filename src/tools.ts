/**
 * @moikapy/origen-zero — Tool registration
 *
 * Registers compiled Zero programs as OrigenTools and provides
 * compileAndRegister for write-compile-verify-register in one call.
 */

import { execFile } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { OrigenTool } from "@moikapy/origen";
import { ZeroCompiler } from "./compiler.js";
import type {
  ZeroToolConfig,
  ZeroSourceFile,
  ZeroDiagnostic,
  ZeroToolRegistrationSuccess,
  ZeroToolRegistrationFailure,
  ZeroBuildOptions,
  ZeroCompilerConfig,
} from "./types.js";
import { ZeroExecutionError } from "./errors.js";

const TEMP_DIR = ".zero-origen/tmp";
const DEFAULT_VERIFY = true;

// ── createZeroTool ───────────────────────────────────────────────────────

/**
 * Register a compiled Zero program's function as an OrigenTool.
 *
 * The tool executes the compiled binary, passing JSON args via stdin,
 * and returns the stdout result as a string.
 */
export function createZeroTool(config: ZeroToolConfig): OrigenTool {
  const shouldVerify = config.verify ?? DEFAULT_VERIFY;

  return {
    name: config.functionName,
    description: config.description,
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const result = await executeBinary(config.executablePath, args);
      return result;
    },
  };
}

// ── createZeroToolsFromProgram ──────────────────────────────────────────

/**
 * Register all exported functions from a Zero program as OrigenTools.
 * Uses `zero graph --json` to discover public functions and their signatures,
 * then creates one OrigenTool per function.
 */
export async function createZeroToolsFromProgram(
  executablePath: string,
  options?: { compiler?: ZeroCompilerConfig; verify?: boolean },
): Promise<OrigenTool[]> {
  const compiler = new ZeroCompiler(options?.compiler);

  // Use zero graph to discover public functions
  const graphResult = await compiler.graph(executablePath);

  const functionNames = Object.keys(graphResult.graph);

  return functionNames.map((fn) =>
    createZeroTool({
      functionName: fn,
      description: `Zero function: ${fn}`,
      executablePath,
      compiler: options?.compiler,
      verify: options?.verify,
    }),
  );
}

// ── compileAndRegister ──────────────────────────────────────────────────

/**
 * Write a Zero source file to disk, compile it, verify it, and register
 * its public functions as OrigenTools — all in one call.
 *
 * If the source has errors, returns them without registering tools.
 */
export async function compileAndRegister(
  source: ZeroSourceFile,
  options?: {
    compiler?: ZeroCompilerConfig;
    build?: ZeroBuildOptions;
  },
): Promise<ZeroToolRegistrationSuccess | ZeroToolRegistrationFailure> {
  const compiler = new ZeroCompiler(options?.compiler);

  // Step 1: Check the source for errors
  const checkResult = await compiler.check(source);

  if (!checkResult.ok) {
    return { errors: checkResult.diagnostics };
  }

  // Step 2: Build the source
  const buildResult = await compiler.build(source, {
    ...options?.build,
    out: options?.build?.out ?? join(TEMP_DIR, source.path.replace(/\.0$/, "")),
  });

  if (!buildResult.ok || !buildResult.outputPath) {
    return {
      errors: buildResult.diagnostics.length > 0
        ? buildResult.diagnostics
        : [
            {
              code: "ZERO_BUILD_FAILED",
              severity: "error",
              message: "Build produced no output",
              line: 0,
            },
          ],
    };
  }

  // Step 3: Discover functions via graph
  const graphResult = await compiler.graph(source);

  // Step 4: Register each function
  const tools: OrigenTool[] = Object.keys(graphResult.graph).map((fn) =>
    createZeroTool({
      functionName: fn,
      description: `Zero function: ${fn}`,
      executablePath: buildResult.outputPath!,
      compiler: options?.compiler,
    }),
  );

  return { tools };
}

// ── Binary execution helper ─────────────────────────────────────────────

/** Execute a compiled Zero binary with JSON args via stdin. */
async function executeBinary(
  executablePath: string,
  args: Record<string, unknown>,
): Promise<string> {
  const stdin = JSON.stringify(args);

  return new Promise((resolve, reject) => {
    const child = execFile(
      executablePath,
      [],
      {
        maxBuffer: 1024 * 1024, // 1MB
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new ZeroExecutionError(
              (error as NodeJS.ErrnoException & { status?: number }).status ?? 1,
              stderr || error.message,
            ),
          );
          return;
        }
        resolve(stdout);
      },
    );

    // Pipe input via stdin
    if (child.stdin) {
      child.stdin.write(stdin, () => {
        child.stdin?.end();
      });
    }
  });
}