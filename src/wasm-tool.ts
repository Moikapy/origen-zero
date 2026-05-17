/**
 * @moikapy/origen-zero — WASM tool execution
 *
 * Executes compiled Zero WASM modules in-process via WebAssembly.instantiate().
 * Works in Cloudflare Workers, browsers, and Node.js — no subprocess needed.
 *
 * WASM modules compiled from Zero export:
 *   - `memory`: WebAssembly.Memory (1+ pages, 64KB each)
 *   - `main()`: Program entry point (returns i32, 0 = success)
 * They import WASI snapshot preview 1 functions for I/O.
 *
 * For Origen tool invocation, args are passed via WASI (args_get/args_sizes_get)
 * for wasm32-wasi targets, or encoded to memory for wasm32-web targets that
 * read from environ.
 */

import type { OrigenTool } from "@moikapy/origen";
import { createZeroWASIRuntime, type ZeroWASIRuntimeConfig } from "./wasi-runtime.js";

// ── Types ─────────────────────────────────────────────────────────────────

export interface ZeroWASMToolConfig {
  /** Tool function name. */
  functionName: string;
  /** Human-readable description for the LLM. */
  description: string;
  /** Compiled WASM module bytes. */
  wasmBytes: ArrayBuffer | WebAssembly.Module;
  /** Optional pre-instantiated module cache (for Workers global scope). */
  module?: WebAssembly.Module;
  /** WASI runtime config (args, env, files, dirs). */
  runtimeConfig?: ZeroWASIRuntimeConfig;
  /** Custom parameter schema for the OrigenTool. */
  parameters?: Record<string, unknown>;
}

// ── Module cache ──────────────────────────────────────────────────────────
// Per-tool module cache. Each tool config can hold its own compiled module,
// avoiding global cache thrashing when multiple WASM tools are active.
// The config.module field is populated on first compile and reused thereafter.

const moduleCache = new WeakMap<ArrayBuffer, WebAssembly.Module>();

async function getModule(
  wasmBytes: ArrayBuffer | WebAssembly.Module,
  precompiled?: WebAssembly.Module,
): Promise<WebAssembly.Module> {
  if (wasmBytes instanceof WebAssembly.Module) return wasmBytes;
  if (precompiled) return precompiled;
  // Check per-bytes cache (same ArrayBuffer reference = same module)
  const cached = moduleCache.get(wasmBytes);
  if (cached) return cached;
  const compiled = await WebAssembly.compile(wasmBytes);
  moduleCache.set(wasmBytes, compiled);
  return compiled;
}

// ── createZeroWASMTool ───────────────────────────────────────────────────

/**
 * Create an OrigenTool that executes a compiled Zero WASM module in-process.
 *
 * The tool instantiates the WASM module with a full WASI runtime,
 * passes args via WASI args_get, calls the exported main() function,
 * and returns the stdout output.
 *
 * Works in Cloudflare Workers, browsers, and Node.js.
 */
export function createZeroWASMTool(config: ZeroWASMToolConfig): OrigenTool {
  return {
    name: config.functionName,
    description: config.description,
    parameters: config.parameters ?? {
      type: "object",
      properties: {},
      required: [],
    },
    async execute(args: Record<string, unknown>, _getD1: any): Promise<string> {
      const module = await getModule(config.wasmBytes, config.module);

      // Pass args as WASI command-line args (JSON-serialized)
      const wasiArgs = ["zero", JSON.stringify(args)];
      const runtime = createZeroWASIRuntime({
        ...config.runtimeConfig,
        args: wasiArgs,
      });

      const instance = await WebAssembly.instantiate(module, runtime.imports);
      runtime.setInstance(instance);

      // Execute the Zero program
      // Cache the compiled module for subsequent invocations
      if (!config.module && config.wasmBytes instanceof ArrayBuffer) {
        (config as ZeroWASMToolConfig).module = module;
      }

      const exitCode = (instance.exports.main as () => number)();

      if (exitCode !== 0) {
        const errOutput = runtime.getStderr();
        const stdOutput = runtime.getStdout();
        return `Error: Zero program exited with code ${exitCode}${errOutput ? `: ${errOutput}` : ""}${stdOutput ? `\n${stdOutput}` : ""}`;
      }

      return runtime.getStdout();
    },
  };
}

/**
 * Create multiple tools from a single Zero WASM module.
 * If the module exports a single main(), creates one tool.
 * Future: parse module exports to discover multiple functions.
 */
export function createZeroWASMTools(
  wasmBytes: ArrayBuffer | WebAssembly.Module,
  options?: { descriptions?: Record<string, string>; parameters?: Record<string, Record<string, unknown>> },
): OrigenTool[] {
  const description = options?.descriptions?.["main"] ?? "Zero program entry point";
  const parameters = options?.parameters?.["main"];

  return [
    createZeroWASMTool({
      functionName: "main",
      description,
      wasmBytes,
      parameters,
    }),
  ];
}