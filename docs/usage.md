# Using @moikapy/origen-zero in a Real Project

## Install

```bash
npm install @moikapy/origen-zero
```

Peer dependency: `@moikapy/origen@^0.6.0` (provides the `OrigenTool` interface).

---

## Use Case 1: Agent Writes & Checks Zero Code (Dev-Time)

The LLM writes Zero code, checks it, fixes errors — all within the conversation.
Uses the **ZeroCompiler** (requires `zero` CLI installed or built from source).

```typescript
import { createAgent } from "@moikapy/origen";
import { ZeroCompiler, createZeroCompilerTools } from "@moikapy/origen-zero/compiler";

// Set up the compiler (point at local Zero CLI)
const compiler = new ZeroCompiler({
  binaryPath: process.env.ZERO_BIN_PATH,  // or just "zero" if on PATH
  timeout: 15000,
});

// Create 4 tools the LLM can call during chat
const [zeroCheck, zeroGraph, zeroSize, zeroFix] = createZeroCompilerTools(compiler);

// Register with Origen agent
const agent = createAgent({
  appName: "my-app",
  tools: [zeroCheck, zeroGraph, zeroSize, zeroFix],
  getD1: async () => null,
  model: "anthropic/claude-sonnet-4-20250514",
});
```

The LLM can now:
- `zero_check` — validate Zero code for errors
- `zero_graph` — see function dependencies
- `zero_size` — get binary size estimates  
- `zero_fix` — get repair suggestions for errors

---

## Use Case 2: Pre-Compiled Zero Tools (Production)

Compile Zero programs to WASM at build time, ship them as in-process tools.
**No subprocess, no HTTP, no Zero CLI needed at runtime.**
Runs in Cloudflare Workers, browsers, Node.js.

### Build Step

```bash
# Build Zero programs to WASM (dev/CI time only)
zero build --emit wasm --target wasm32-web src/calculator.0 --out dist/calculator
zero build --emit wasm --target wasm32-web src/formatter.0 --out dist/formatter
```

### Runtime (Workers / Node / Browser)

```typescript
import { createAgent } from "@moikapy/origen";
import { createZeroWASMTool, createZeroWASIRuntime } from "@moikapy/origen-zero/wasm-tool";
import calculatorWasm from "./dist/calculator.wasm";
import formatterWasm from "./dist/formatter.wasm";

// Create tools from pre-compiled WASM modules
const calculator = createZeroWASMTool({
  functionName: "calculate",
  description: "Performs calculations defined in Zero",
  wasmBytes: calculatorWasm,
  parameters: {
    type: "object",
    properties: {
      expression: { type: "string", description: "Math expression to evaluate" },
    },
    required: ["expression"],
  },
});

const formatter = createZeroWASMTool({
  functionName: "format_data",
  description: "Formats data using Zero-defined rules",
  wasmBytes: formatterWasm,
});

// Register with agent
const agent = createAgent({
  appName: "my-app",
  tools: [calculator, formatter],
  getD1: async () => null,
});
```

### With WASI Runtime (args, env, filesystem)

For Zero programs that use `std.args`, `std.env`, or `std.fs`:

```typescript
import { createZeroWASMTool } from "@moikapy/origen-zero/wasm-tool";
import { createZeroWASIRuntime } from "@moikapy/origen-zero/wasi-runtime";

const runtimeConfig = createZeroWASIRuntime({
  args: ["zero", "--format", "json"],
  env: ["MODE=production", "DEBUG=false"],
  files: new Map([["/data/config.json", Buffer.from('{"key": "value"}')]]),
  dirs: new Set(["/data", "/tmp"]),
});

const tool = createZeroWASMTool({
  functionName: "process_data",
  description: "Process data files with Zero",
  wasmBytes: myWasmModule,
  runtimeConfig,
});
```

---

## Use Case 3: Full Loop — Write, Check, Build, Register

Compile a Zero program on-the-fly and register it as a tool:

```typescript
import { createAgent } from "@moikapy/origen";
import { ZeroCompiler } from "@moikapy/origen-zero/compiler";
import { compileAndRegister } from "@moikapy/origen-zero/tools";

const compiler = new ZeroCompiler({ binaryPath: "zero" });

// The LLM writes Zero source, we compile and register it
const source = `
pub fun main(world: World) -> Void raises {
  check world.out.write("hello from zero\\n")
}
`;

const result = await compileAndRegister(
  { path: "hello.0", content: source },
  {
    compiler,
    execution: { mode: "subprocess", executablePath: "/tmp/hello" },
    build: { emit: "wasm", target: "wasm32-web", out: "/tmp/hello" },
  }
);

if ("tools" in result) {
  // Success — tools are ready to use with Origen
  agent.tools.push(...result.tools);
} else {
  // Errors — return to LLM for self-repair
  console.error("Compilation failed:", result.errors);
}
```

---

## Use Case 4: HTTP Compiler (Workers + Remote Service)

If Zero CLI runs on a separate server, Workers can call it via HTTP:

```typescript
import { createZeroCompilerTools } from "@moikapy/origen-zero/compiler-tools";
import { ZeroHTTPCompiler } from "@moikapy/origen-zero/http-compiler";

const httpCompiler = new ZeroHTTPCompiler({
  endpoint: "https://zero-service.my-app.workers.dev",
  apiKey: process.env.ZERO_API_KEY,
});

const [check, graph, size, fix] = createZeroCompilerTools(httpCompiler);

// Use in Workers — no Zero CLI binary needed
const agent = createAgent({
  appName: "my-workers-app",
  tools: [check, graph, size, fix],
  getD1: async () => d1,
});
```

---

## Entry Points

| Import | What | Use When |
|---|---|---|
| `@moikapy/origen-zero` | Core types + errors | Always |
| `@moikapy/origen-zero/compiler` | ZeroCompiler (CLI) | Dev-time: check, graph, size, build, fix |
| `@moikapy/origen-zero/http-compiler` | ZeroHTTPCompiler | Workers calling a remote Zero service |
| `@moikapy/origen-zero/tools` | createZeroTool, compileAndRegister | Creating & registering Zero tools |
| `@moikapy/origen-zero/wasm-tool` | createZeroWASMTool | Runtime: WASM execution in Workers |
| `@moikapy/origen-zero/wasi-runtime` | createZeroWASIRuntime | Advanced: WASI args, env, fs for WASM |