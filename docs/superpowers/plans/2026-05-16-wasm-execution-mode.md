# SPEC ADDENDUM: WASM Execution Mode

> Added: 2026-05-16
> Status: Draft

## The Key Insight

Zero compiles to `wasm32-web`. The `zero build --target wasm32-web` command produces a WASM module that runs in any environment with `WebAssembly.instantiate()` — including Cloudflare Workers.

This eliminates the need for subprocess execution in production.

## Revised Architecture

### What runs WHERE

| Operation | When | Where | How |
|---|---|---|---|
| `zero check/graph/size/fix` | Dev/Build time | Local or CI | `ZeroCompiler` (subprocess) or `ZeroHTTPCompiler` |
| `zero build --target wasm32-web` | Build time | Local or CI | `ZeroCompiler.build()` |
| Execute compiled Zero function | Runtime | Workers | WASM execution in-process |
| Execute compiled Zero function | Runtime | Node/Bun | Subprocess or WASM |

### The WASM execution path

```typescript
import { createZeroWASMTool } from "@moikapy/origen-zero/tools";

// In Workers — WASM runs in-process, no subprocess needed
const tool = createZeroWASMTool({
  functionName: "lookup",
  description: "Look up a Bible verse by reference",
  wasmModule: wasmBuffer,  // loaded from KV, R2, or bundled
});

// The tool's execute() calls the WASM function directly
const result = await tool.execute({ reference: "GEN 1:1" });
```

## New Types

```typescript
/** Configuration for WASM-executed Zero tools. */
export interface ZeroWASMToolConfig {
  functionName: string;
  description: string;
  /** Compiled WASM module (ArrayBuffer or WebAssembly.Module). */
  wasmModule: ArrayBuffer | WebAssembly.Module;
  /** Memory allocator for WASM instance. Optional. */
  memory?: WebAssembly.Memory;
}

/** Extend ZeroToolExecution discriminated union */
export type ZeroToolExecution =
  | { mode: "subprocess"; executablePath: string }
  | { mode: "http"; endpoint: string; apiKey?: string; headers?: Record<string, string>; fetch?: typeof globalThis.fetch }
  | { mode: "wasm"; wasmModule: ArrayBuffer | WebAssembly.Module; memory?: WebAssembly.Memory };
```

## Package Creation Workflow

The `zero new` command scaffolds a package. We add a template for Origen-integrated packages:

```bash
# User creates a Zero package for an Origen tool
zero new cli bible-lookup
cd bible-lookup

# Edit src/main.0 to define the tool function
# Add wasm32-web target to zero.json
```

`zero.json`:
```json
{
  "package": { "name": "bible-lookup", "version": "0.1.0" },
  "targets": {
    "cli": { "kind": "exe", "main": "src/main.0" },
    "web": { "kind": "web", "runtime": "wasm32-web", "routes": "src/routes" }
  }
}
```

Build for web:
```bash
zero build --target wasm32-web --out dist/bible-lookup.wasm .
```

Then in Workers:
```typescript
import wasmBuffer from "./dist/bible-lookup.wasm";

const tool = createZeroWASMTool({
  functionName: "lookup",
  description: "Look up a Bible verse by reference",
  wasmModule: wasmBuffer,
});
```

## What Changes in origen-zero

### New exports

- `createZeroWASMTool(config: ZeroWASMToolConfig): OrigenTool` — WASM-based tool execution
- `ZeroToolExecution` gains `mode: "wasm"` variant

### What stays the same

- `ZeroCompiler` — still needed for dev-time `check`, `graph`, `size`, `fix`, `build`
- `ZeroHTTPCompiler` — still needed for dev-time in Workers (if you want LLM to check code)
- `createZeroTool({ execution: { mode: "subprocess", ... } })` — still works for Node/Bun
- `createZeroTool({ execution: { mode: "http", ... } })` — still works for any HTTP-based execution

### What's now optional

- **Zero HTTP service** — No longer needed for production tool execution. WASM runs in-process.
- **Subprocess execution** — No longer the only option for production.

### The WASM execution interface

Zero's `wasm32-web` target expects WASM imports (the `World` capability). The `createZeroWASMTool` function provides those imports:

```typescript
// The WASM module's exported function is called with JSON args
// serialized to WASM linear memory, and the result is read back.
//
// This mirrors the subprocess contract (JSON stdin → JSON stdout)
// but runs entirely in-process via WebAssembly.
```

## Why This Works

1. **Zero already has `wasm32-web`** — No feature request needed. It exists today.
2. **Workers support WASM** — `WebAssembly.instantiate()` is a standard API in Workers.
3. **No subprocess, no HTTP** — The WASM module runs in the same isolate as your Worker code.
4. **No cold start penalty** — WASM modules can be cached in Workers' global scope.
5. **Same DX** — Build locally, deploy the `.wasm` artifact, register as a tool.

## Current State (v0.1.1)

- `zero check --target wasm32-web` ✅ — validates capability restrictions for the web target
- `zero graph --json` ✅ — rich structured output with stdlib info, capability facts, symbols
- WASM web target is declared and validated but **build is not yet wired**
- CGEN004 error: the `zero-wasm` object emitter needs the self-hosted compiler (`compiler-zero`), which hasn't shipped
- Native Linux/macOS/Windows builds work fine

## What's Ready Now

1. **Compiler tools** (`check`, `graph`, `size`, `fix`) — fully working with the CLI
2. **Structured diagnostics** — far richer than the spec assumed (schemaVersion, stdlibHelpers, interfaceFingerprints, symbols, capability facts, etc.)
3. **Package targets** — `zero.json` with multiple targets (cli + web)
4. **HTTP compiler** — for Workers dev-time use

## What's Coming (needs Zero WASM backend)

1. `createZeroWASMTool()` — WASM execution in Cloudflare Workers
2. `zero build --target wasm32-web` — producing `.wasm` artifacts
3. In-process WASM execution without subprocess or HTTP