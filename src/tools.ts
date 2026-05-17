/**
 * @moikapy/origen-zero — Tool registration
 *
 * Registers compiled Zero programs as OrigenTools and provides
 * compileAndRegister for write-compile-verify-register in one call.
 *
 * Supports two execution modes:
 *   - "subprocess": Spawns compiled binary (Node/Bun only)
 *   - "http": Calls a Zero execution service via fetch (Workers-compatible)
 */

import type { OrigenTool } from "@moikapy/origen";
import { ZeroCompiler, TEMP_DIR } from "./compiler.js";
import type {
  ZeroCompilerLike,
  ZeroToolConfig,
  ZeroToolExecution,
  ZeroSourceFile,
  ZeroToolRegistrationSuccess,
  ZeroToolRegistrationFailure,
  ZeroBuildOptions,
  ZeroCompilerConfig,
} from "./types.js";
import { ZeroExecutionError, ZeroHTTPError } from "./errors.js";

const DEFAULT_VERIFY = true;

// ── createZeroTool ───────────────────────────────────────────────────────

/**
 * Register a compiled Zero program's function as an OrigenTool.
 *
 * In "subprocess" mode, executes the compiled binary via execFile.
 * In "http" mode, calls a Zero execution service via fetch.
 */
export function createZeroTool(config: ZeroToolConfig): OrigenTool {
  return {
    name: config.functionName,
    description: config.description,
    parameters: config.parameters ?? {
      type: "object",
      properties: {},
      required: [],
    },
    inputSchema: config.inputSchema,
    async execute(args: Record<string, unknown>): Promise<string> {
      return executeTool(config.execution, args);
    },
  } as OrigenTool;
}

// ── createZeroToolsFromProgram ──────────────────────────────────────────

/**
 * Register all exported functions from a Zero program as OrigenTools.
 * Uses the compiler's graph() to discover public functions,
 * then creates one OrigenTool per function.
 */
export async function createZeroToolsFromProgram(
  execution: ZeroToolExecution,
  options?: {
    compiler?: ZeroCompilerLike | ZeroCompilerConfig;
    verify?: boolean;
  },
): Promise<OrigenTool[]> {
  const compiler = resolveCompiler(options?.compiler);

  // Use graph to discover public functions
  const source: ZeroSourceFile =
    execution.mode === "subprocess"
      ? { path: execution.executablePath }
      : { path: "program.0" }; // HTTP mode — path is a hint

  const graphResult = await compiler.graph(source);
  const functionNames = graphResult.functions.map(f => f.name);

  return functionNames.map((fn) =>
    createZeroTool({
      functionName: fn,
      description: `Zero function: ${fn}`,
      execution,
      compiler,
      verify: options?.verify,
    }),
  );
}

// ── compileAndRegister ──────────────────────────────────────────────────

/**
 * Write a Zero source file, compile it, verify it, and register
 * its public functions as OrigenTools — all in one call.
 *
 * If the source has errors, returns them without registering tools.
 *
 * Note: build() only works with ZeroCompiler (subprocess), not ZeroHTTPCompiler.
 * HTTP mode requires pre-compiled binaries or a build service.
 */
export async function compileAndRegister(
  source: ZeroSourceFile,
  options?: {
    compiler?: ZeroCompilerLike | ZeroCompilerConfig;
    execution?: ZeroToolExecution;
    build?: ZeroBuildOptions;
  },
): Promise<ZeroToolRegistrationSuccess | ZeroToolRegistrationFailure> {
  const compiler = resolveCompiler(options?.compiler);
  const execution: ZeroToolExecution = options?.execution ?? {
    mode: "subprocess",
    executablePath: source.path.replace(/\.0$/, ""),
  };

  // Step 1: Check the source for errors
  const checkResult = await compiler.check(source);

  if (!checkResult.ok) {
    return { errors: checkResult.diagnostics };
  }

  // Step 2: Build (only with subprocess compiler)
  if (execution.mode === "subprocess" && compiler instanceof ZeroCompiler) {
    const buildResult = await compiler.build(source, {
      ...options?.build,
      out: options?.build?.out ?? execution.executablePath,
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

    // Update execution path to the built binary
    execution.executablePath = buildResult.outputPath;
  }

  // Step 3: Discover functions via graph
  const graphResult = await compiler.graph(source);

  // Step 4: Register each function
  const tools: OrigenTool[] = graphResult.functions.map((f) =>
    createZeroTool({
      functionName: f.name,
      description: `Zero function: ${f.name}`,
      execution,
      compiler,
    }),
  );

  return { tools };
}

// ── Tool execution ───────────────────────────────────────────────────────

/** Execute a tool based on the execution mode. */
async function executeTool(
  execution: ZeroToolExecution,
  args: Record<string, unknown>,
): Promise<string> {
  switch (execution.mode) {
    case "subprocess":
      return executeBinary(execution.executablePath, args);
    case "http":
      return executeHTTP(execution, args);
    case "wasm": {
      const { createZeroWASMTool } = await import("./wasm-tool.js");
      const tool = createZeroWASMTool({
        functionName: "main",
        description: "Zero WASM tool",
        wasmBytes: execution.wasmBytes,
      });
      return tool.execute(args, async () => null as any);
    }
  }
}

/** Execute a compiled Zero binary with JSON args via stdin. */
async function executeBinary(
  executablePath: string,
  args: Record<string, unknown>,
): Promise<string> {
  const { execFile } = await import("node:child_process");
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
              ((error as any).code as number) ?? 1,
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

/** Execute a Zero function via HTTP. */
async function executeHTTP(
  execution: ZeroToolExecution & { mode: "http" },
  args: Record<string, unknown>,
): Promise<string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...execution.headers,
  };
  if (execution.apiKey) {
    headers["Authorization"] = execution.apiKey;
  }

  const fetchFn = execution.fetch ?? globalThis.fetch;
  const url = `${execution.endpoint.replace(/\/+$/, "")}/execute`;

  const res = await fetchFn(url, {
    method: "POST",
    headers,
    body: JSON.stringify(args),
  });

  if (!res.ok) {
    throw new ZeroHTTPError(res.status, url, await res.text());
  }

  return await res.text();
}

// ── Compiler resolution ──────────────────────────────────────────────────

/** Resolve a compiler config or instance to a ZeroCompilerLike. */
function resolveCompiler(
  compiler?: ZeroCompilerLike | ZeroCompilerConfig,
): ZeroCompilerLike {
  if (!compiler) return new ZeroCompiler();
  if ("check" in compiler && typeof compiler.check === "function") {
    return compiler as ZeroCompilerLike;
  }
  return new ZeroCompiler(compiler as ZeroCompilerConfig);
}