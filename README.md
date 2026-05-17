# @moikapy/origen-zero

Bridge package connecting [Origen](https://www.npmjs.com/package/@moikapy/origen) agents to the [ZeroLang](https://zerolang.ai) compiler and runtime.

## Why?

Origen agents write tool logic in TypeScript. ZeroLang is a **systems language designed for agents** — structured compiler output, explicit effects, repair metadata, and JSON diagnostics are first-class. This package bridges the two:

- **Define tools in Zero** — Write `.0` files, compile them, get structured diagnostics before registration
- **Register as OrigenTools** — Zero functions become first-class Origen tools
- **Interactive compiler tools** — `zero_check`, `zero_graph`, `zero_size`, `zero_fix` as Origen tools
- **Self-modify** — Write, check, fix, and register tools during a single conversation session

## Install

```bash
npm install @moikapy/origen-zero
```

**Prerequisites:**
- `@moikapy/origen` ^0.6.0 (peer dependency)
- Zero CLI installed and available on `$PATH` — [install guide](https://zerolang.ai)

## Usage

### Register a Compiled Zero Binary as OrigenTool

```typescript
import { createZeroTool } from "@moikapy/origen-zero/tools";
import { streamOrigen } from "@moikapy/origen";

const lookupTool = createZeroTool({
  functionName: "lookup",
  description: "Look up a record by ID",
  executablePath: "./bin/lookup",
});

const config = {
  appName: "MyAgent",
  tools: [lookupTool],
  getD1: async () => myD1,
};
```

### Interactive Compiler Tools (LLM Calls Zero CLI)

```typescript
import { createZeroCompilerTools } from "@moikapy/origen-zero/tools";

const compilerTools = createZeroCompilerTools();
// Returns: [zero_check, zero_graph, zero_size, zero_fix]
```

### Write, Check, Fix, Register — Full Loop

```typescript
import { compileAndRegister } from "@moikapy/origen-zero/tools";

const result = await compileAndRegister({
  path: "math.0",
  content: sourceCode,
});

if ("tools" in result) {
  // ✅ Compiled — result.tools are ready
} else {
  // ❌ Errors — return to LLM for self-repair
  console.log(result.errors);
}
```

### Direct Compiler Access

```typescript
import { ZeroCompiler } from "@moikapy/origen-zero/compiler";

const compiler = new ZeroCompiler({ binaryPath: "zero", timeout: 10000 });

// Check for errors
const result = await compiler.check("fun add(a: i32, b: i32) -> i32 => a + b");
if (result.ok) { /* clean */ }

// Get dependency graph
const graph = await compiler.graph("./src/math.0");

// Get size estimates
const sizes = await compiler.size("./src/math.0");
```

## API

### `ZeroCompiler`

| Method | Description | Zero CLI |
|---|---|---|
| `check(source)` | Check for errors, return diagnostics | `zero check --json` |
| `graph(source)` | Get dependency graph | `zero graph --json` |
| `size(source)` | Get function size estimates | `zero size --json` |
| `fix(source)` | Get repair suggestions | `zero fix --plan --json` |
| `build(source, opts?)` | Compile to native executable | `zero build` |
| `explain(code)` | Human-readable diagnostic explanation | `zero explain` |

### Tool Registration

| Function | Description |
|---|---|
| `createZeroTool(config)` | Register a compiled Zero function as an OrigenTool |
| `createZeroToolsFromProgram(path, opts?)` | Discover and register all public functions |
| `compileAndRegister(source, opts?)` | Write → compile → verify → register in one call |

### Interactive Compiler Tools

| Tool Name | Description |
|---|---|
| `zero_check` | Check Zero source for errors |
| `zero_graph` | Show dependency graph |
| `zero_size` | Show function size estimates |
| `zero_fix` | Suggest repairs for errors |

## Error Types

| Error | When |
|---|---|
| `ZeroCompilerNotFoundError` | `zero` binary not on PATH |
| `ZeroCheckFailedError` | Source has diagnostics |
| `ZeroBuildFailedError` | Build produces no output |
| `ZeroTimeoutError` | CLI invocation exceeds timeout |
| `ZeroExecutionError` | Compiled binary exits non-zero |

## License

MIT