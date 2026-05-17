/**
 * @moikapy/origen-zero — WASM tool execution
 *
 * Executes compiled Zero WASM modules in-process via WebAssembly.instantiate().
 * Works in Cloudflare Workers, browsers, and Node.js — no subprocess needed.
 *
 * WASM modules compiled from Zero export:
 *   - `memory`: WebAssembly.Memory (1+ pages, 64KB each)
 *   - `main()`: Program entry point (returns i32, 0 = success)
 * They import:
 *   - `wasi_snapshot_preview1.fd_write`: For stdout output
 *
 * For Origen tool invocation, args are serialized to JSON and written to
 * linear memory at a fixed offset (ARGS_OFFSET). The Zero program reads
 * from there. The result is captured from stdout via fd_write.
 */

import type { OrigenTool } from "@moikapy/origen";
import type { ZeroDiagnostic } from "./types.js";

// ── Constants ────────────────────────────────────────────────────────────

/** Offset in linear memory where we write JSON args. Page 1 start. */
const ARGS_OFFSET = 65536; // Second page (page 0 is stack/readonly data)
/** Maximum args size in bytes. */
const MAX_ARGS_SIZE = 32768; // 32KB — half a page
/** Offset where we write the args length as a u32. */
const ARGS_LEN_OFFSET = ARGS_OFFSET - 4;

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
}

interface ZeroWASMInstance {
  main(): number;
  memory: WebAssembly.Memory;
}

// ── Module cache ──────────────────────────────────────────────────────────

/** Cache compiled modules for reuse across invocations. */
let cachedModule: WebAssembly.Module | null = null;
let cachedModuleSource: ArrayBuffer | null = null;

async function getModule(
  wasmBytes: ArrayBuffer | WebAssembly.Module,
): Promise<WebAssembly.Module> {
  if (wasmBytes instanceof WebAssembly.Module) return wasmBytes;
  if (cachedModule && cachedModuleSource === wasmBytes) return cachedModule;
  cachedModule = await WebAssembly.compile(wasmBytes);
  cachedModuleSource = wasmBytes;
  return cachedModule;
}

// ── WASI shim ─────────────────────────────────────────────────────────────

/**
 * Minimal WASI implementation that captures stdout writes.
 * Zero programs that use `World.out.write()` call `fd_write(1, ...)` 
 * through this import.
 */
function createWASI(): {
  imports: Record<string, Record<string, WebAssembly.ImportValue>>;
  getOutput: () => string;
} {
  let output = "";
  let instance: ZeroWASMInstance | null = null;

  return {
    imports: {
      wasi_snapshot_preview1: {
        fd_write: (fd: number, iovs: number, _iovsLen: number, nwritten: number): number => {
          if (!instance) return 8; // EBADF
          const mem = new DataView(instance.memory.buffer);
          const ptr = mem.getUint32(iovs, true);
          const len = mem.getUint32(iovs + 4, true);
          if (len > 0 && ptr > 0) {
            const bytes = new Uint8Array(instance.memory.buffer, ptr, len);
            output += new TextDecoder().decode(bytes);
          }
          mem.setUint32(nwritten, len, true);
          return 0; // success
        },
      },
    },
    getOutput: () => output,
    // Note: instance must be set after instantiation
    setInstance(i: ZeroWASMInstance) { instance = i; },
  } as any; // Cast needed because setInstance is our addition
}

// ── createZeroWASMTool ───────────────────────────────────────────────────

/**
 * Create an OrigenTool that executes a compiled Zero WASM module in-process.
 *
 * The tool instantiates the WASM module, writes JSON args to linear memory,
 * calls the exported main() function, and returns the stdout output.
 *
 * Works in Cloudflare Workers, browsers, and Node.js.
 */
export function createZeroWASMTool(config: ZeroWASMToolConfig): OrigenTool {
  return {
    name: config.functionName,
    description: config.description,
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const module = await getModule(config.wasmBytes);
      const wasi = createWASI();

      const instance = await WebAssembly.instantiate(module, wasi.imports) as any;
      const wasmInstance: ZeroWASMInstance = {
        main: instance.exports.main as () => number,
        memory: instance.exports.memory as WebAssembly.Memory,
      };

      // Wire up the WASI shim to the instance
      (wasi as any).setInstance(wasmInstance);

      // Write args to linear memory if provided
      const argsJson = JSON.stringify(args);
      const argsBytes = new TextEncoder().encode(argsJson);

      if (argsBytes.length > 0 && argsBytes.length <= MAX_ARGS_SIZE) {
        // Grow memory if needed (ensure at least 2 pages)
        const neededPages = Math.ceil((ARGS_OFFSET + argsBytes.length) / 65536);
        const currentPages = wasmInstance.memory.buffer.byteLength / 65536;
        if (neededPages > currentPages) {
          wasmInstance.memory.grow(neededPages - currentPages);
        }

        // Re-get buffer after potential growth
        const mem = new Uint8Array(wasmInstance.memory.buffer);
        mem.set(argsBytes, ARGS_OFFSET);

        // Write args length at ARGS_LEN_OFFSET
        const view = new DataView(wasmInstance.memory.buffer);
        view.setUint32(ARGS_LEN_OFFSET, argsBytes.length, true);
      }

      // Execute the Zero program
      const exitCode = wasmInstance.main();

      if (exitCode !== 0) {
        const stderr = wasi.getOutput();
        return `Error: Zero program exited with code ${exitCode}${stderr ? `: ${stderr}` : ""}`;
      }

      return wasi.getOutput();
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
  options?: { descriptions?: Record<string, string> },
): OrigenTool[] {
  // Zero WASM modules currently export only `main` + `memory`
  // Multi-function tools would need separate compilation or
  // a routing function inside the Zero program.
  const description = options?.descriptions?.["main"] ?? "Zero program entry point";

  return [
    createZeroWASMTool({
      functionName: "main",
      description,
      wasmBytes,
    }),
  ];
}