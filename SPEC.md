# SPEC: Origen × ZeroLang Integration

> **Status**: Draft
> **Author**: Shalom 🐉
> **Date**: 2026-05-16

---

## 1. Overview

### Problem

Origen agents write tool logic in TypeScript with loose JSON Schema parameter definitions. When the LLM calls a tool with bad args, the failure only surfaces at runtime. There's no compile-time verification that tool interfaces are consistent, well-typed, or internally coherent.

Meanwhile, ZeroLang (Vercel Labs) is a **systems language designed for agents** — structured compiler output, explicit effects, repair metadata, and JSON diagnostics are first-class. It's built precisely so agents can write, check, fix, and ship small programs with machine-readable feedback.

These two are a natural pair:
- **Origen** gives agents a multi-provider LLM loop, streaming, memory, wiki, and D1
- **ZeroLang** gives agents a verified, compilable tool-definition and computation language

### What We're Building

A bridge package `@moikapy/origen-zero` that lets Origen agents:

1. **Define tools in Zero** — Write `.0` files, compile them, get structured diagnostics before registration
2. **Register compiled Zero programs as OrigenTools** — Zero functions become first-class Origen tools
3. **Use Zero's compiler as an interactive tool** — `zero_check`, `zero_graph`, `zero_size`, `zero_fix` as Origen tools the LLM can call during conversation
4. **Self-modify** — Agents write Zero programs, check them, fix them, and register the resulting tools during a single conversation session

### What We're NOT Building (v1)

- A Zero runtime or REPL embedded in JS
- Automatic transpilation of Zero → TypeScript
- Zero-to-WASM compilation pipeline
- A Zero IDE or web playground
- Replacing Origen's existing tool system

---

## 2. Package

```
@moikapy/origen-zero
```

**Runtime**: Node.js 20+, Bun, Cloudflare Workers (limited — Zero CLI requires subprocess spawn)

**Peer dependencies**:
- `@moikapy/origen` ^0.6.0
- `zero` CLI installed and available on `$PATH` (or configured path)

**Exports map**:
```json
{
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js"
  },
  "./tools": {
    "types": "./dist/tools.d.ts",
    "import": "./dist/tools.js"
  },
  "./compiler": {
    "types": "./dist/compiler.d.ts",
    "import": "./dist/compiler.js"
  }
}
```

---

## 3. Client API

### 3.1 ZeroCompiler — Compiler Interface

```typescript
// compiler.ts

export interface ZeroCompilerConfig {
  /** Path to zero CLI binary. Default: "zero" (must be on PATH) */
  binaryPath?: string;
  /** Working directory for compilation. Default: process.cwd() */
  workingDir?: string;
  /** Timeout for compiler invocations in ms. Default: 30000 */
  timeout?: number;
}

export interface ZeroDiagnostic {
  code: string;        // e.g., "NAM003", "TYP001"
  severity: "error" | "warning" | "info";
  message: string;
  line: number;
  column?: number;
  /** Repair metadata — structured suggestion from the compiler */
  repair?: {
    id: string;       // e.g., "declare-missing-symbol"
    suggestion?: string;
  };
}

export interface ZeroCheckResult {
  ok: boolean;
  diagnostics: ZeroDiagnostic[];
  /** Raw JSON output from zero check --json */
  raw: Record<string, unknown>;
}

export interface ZeroGraphResult {
  ok: boolean;
  /** Dependency graph as adjacency list */
  graph: Record<string, string[]>;
  raw: Record<string, unknown>;
}

export interface ZeroSizeResult {
  ok: boolean;
  /** Size report — function sizes, total binary size estimate */
  sizes: Record<string, number>;
  raw: Record<string, unknown>;
}

export interface ZeroBuildResult {
  ok: boolean;
  /** Path to compiled output */
  outputPath?: string;
  diagnostics: ZeroDiagnostic[];
}

export class ZeroCompiler {
  constructor(config?: ZeroCompilerConfig);

  /** Check a Zero file or package for errors. Returns structured diagnostics. */
  check(source: string | ZeroSourceFile): Promise<ZeroCheckResult>;

  /** Get the dependency graph for a Zero package. */
  graph(source: string | ZeroSourceFile): Promise<ZeroGraphResult>;

  /** Get size estimates for functions in a Zero file. */
  size(source: string | ZeroSourceFile): Promise<ZeroSizeResult>;

  /** Build a Zero file to a native executable. */
  build(source: string | ZeroSourceFile, options?: ZeroBuildOptions): Promise<ZeroBuildResult>;

  /** Get a typed repair suggestion for a diagnostic code. */
  explain(diagnosticCode: string): Promise<string>;
}

/** A Zero source file: either a path on disk or inline content. */
export interface ZeroSourceFile {
  /** File path (relative to workingDir). Used for error reporting. */
  path: string;
  /** Source content. If omitted, reads from disk at path. */
  content?: string;
}

export interface ZeroBuildOptions {
  /** Output path for compiled binary. */
  out?: string;
  /** Target triple, e.g., "linux-musl-x64". */
  target?: string;
  /** Emit format: "exe" (default) or "object". */
  emit?: "exe" | "object";
}
```

### 3.2 Zero Tool Registration — Zero Functions as OrigenTools

```typescript
// tools.ts

export interface ZeroToolConfig {
  /** The Zero function to expose as a tool. */
  functionName: string;
  /** Human-readable description for the LLM. Required. */
  description: string;
  /** Path to the compiled Zero executable. */
  executablePath: string;
  /** Zero CLI config for verification before registration. */
  compiler?: ZeroCompilerConfig;
  /** Whether to verify the tool compiles cleanly before registering. Default: true */
  verify?: boolean;
}

/**
 * Register a compiled Zero program's function as an Origen tool.
 *
 * The tool executes the compiled binary, passing JSON args via stdin,
 * and returns the stdout result as a string.
 */
export function createZeroTool(config: ZeroToolConfig): OrigenTool;

/**
 * Register all exported functions from a Zero program as OrigenTools.
 * Uses zero graph --json to discover public functions and their signatures,
 * then creates one OrigenTool per function.
 */
export function createZeroToolsFromProgram(
  executablePath: string,
  options?: { compiler?: ZeroCompilerConfig; verify?: boolean }
): Promise<OrigenTool[]>;

/**
 * Write a Zero source file to disk, compile it, verify it, and register
 * its public functions as OrigenTools — all in one call.
 *
 * If the source has errors, returns them without registering tools.
 */
export function compileAndRegister(
  source: ZeroSourceFile,
  options?: { compiler?: ZeroCompilerConfig; build?: ZeroBuildOptions }
): Promise<{ tools: OrigenTool[] } | { errors: ZeroDiagnostic[] }>;
```

### 3.3 Interactive Compiler Tools — LLM Calls Zero CLI During Chat

```typescript
// tools.ts (continued)

/**
 * Create the set of interactive Zero compiler tools that let the LLM
 * write, check, and fix Zero programs during a conversation.
 *
 * These tools give the agent a REPL-like experience with ZeroLang,
 * backed by the structured compiler output.
 */
export function createZeroCompilerTools(
  compiler?: ZeroCompilerConfig
): OrigenTool[];
```

The four interactive tools:

| Tool Name | Description | Zero CLI |
|---|---|---|
| `zero_check` | Check a Zero program for errors. Returns structured diagnostics with repair suggestions. | `zero check --json` |
| `zero_graph` | Get the dependency graph of a Zero program. | `zero graph --json` |
| `zero_size` | Get size estimates for functions in a Zero program. | `zero size --json` |
| `zero_fix` | Plan repairs for a Zero program. Returns suggested fixes with line numbers. | `zero fix --plan --json` |

Each tool:
- Accepts `source` (inline code string) and optional `path` arguments
- Writes the source to a temp file in `.zero-origen/tmp/`
- Invokes the Zero CLI with `--json` flag
- Parses and returns the structured result
- Cleans up temp files

### 3.4 Zero Tool Executor — How Zero Tools Execute

When the LLM calls a Zero-originated OrigenTool:

1. The tool's `execute()` function spawns the compiled binary as a subprocess
2. Input args are serialized to JSON and piped to stdin
3. The binary reads from stdin, processes, and writes JSON to stdout
4. The tool captures stdout and returns it as the `string` result
5. If the process exits non-zero, the tool returns `Error: <stderr>`

This is the same pattern shell-based tools use, but with Zero's explicit effects guaranteeing the binary won't do unexpected I/O.

---

## 4. Zod Schemas / Types

### 4.1 Compiler Output Types

```typescript
// All diagnostics include a machine-readable code and optional repair suggestion
const ZeroDiagnosticSchema = z.object({
  code: z.string().regex(/^[A-Z]{3}\d{3}$/),  // e.g., NAM003
  severity: z.enum(["error", "warning", "info"]),
  message: z.string(),
  line: z.number().int().positive(),
  column: z.number().int().positive().optional(),
  repair: z.object({
    id: z.string(),
    suggestion: z.string().optional(),
  }).optional(),
});

// Check result — zero check --json
const ZeroCheckResultSchema = z.object({
  ok: z.boolean(),
  diagnostics: z.array(ZeroDiagnosticSchema),
  raw: z.record(z.unknown()),
});

// Graph result — zero graph --json
const ZeroGraphResultSchema = z.object({
  ok: z.boolean(),
  graph: z.record(z.array(z.string())),
  raw: z.record(z.unknown()),
});

// Size result — zero size --json
const ZeroSizeResultSchema = z.object({
  ok: z.boolean(),
  sizes: z.record(z.number()),
  raw: z.record(z.unknown()),
});
```

### 4.2 Tool Parameter Schemas

```typescript
// zero_check tool input
const ZeroCheckInputSchema = z.object({
  source: z.string().describe("Zero source code to check"),
  path: z.string().optional().describe("File path hint for error reporting"),
});

// zero_graph tool input
const ZeroGraphInputSchema = z.object({
  source: z.string().describe("Zero source code to analyze"),
  path: z.string().optional(),
});

// zero_size tool input
const ZeroSizeInputSchema = z.object({
  source: z.string().describe("Zero source code to size-report"),
  path: z.string().optional(),
});

// zero_fix tool input
const ZeroFixInputSchema = z.object({
  source: z.string().describe("Zero source code to repair"),
  path: z.string().optional(),
});
```

---

## 5. Upstream API Reference

### Zero CLI Commands (Internal)

The Zero CLI is the sole interface. All commands support `--json` for structured output.

| Command | Purpose | Output |
|---|---|---|
| `zero check --json <path>` | Type-check and validate | `{ ok, diagnostics: [...] }` |
| `zero graph --json <path>` | Dependency graph | `{ ok, graph: {...} }` |
| `zero size --json <path>` | Size estimates | `{ ok, sizes: {...} }` |
| `zero fix --plan --json <path>` | Suggest repairs | `{ ok, fixes: [...] }` |
| `zero build --emit exe --target <triple> <path> --out <out>` | Compile to native | Binary at `--out` path |
| `zero explain <code>` | Human-readable explanation of diagnostic code | Plain text |
| `zero doctor --json` | Environment diagnostics | `{ ok, checks: [...] }` |

### Zero Source Language (Quick Reference)

```
# Functions with explicit effects
pub fun main(world: World) -> Void raises {
  check world.out.write("hello\n")
}

# Inline modifiers
return x if condition
x++ while n < 10

# Error handling — errors are values
fun parse(input: String) -> Result<i32, ParseError> raises {
  ...
}
```

Key properties for Origen integration:
- **Explicit effects**: Functions declare what they do (e.g., `raises` for fallible)
- **Structured errors**: Every diagnostic has a machine-readable code
- **Repair metadata**: The compiler suggests fixes with `repair.id`
- **Self-documenting**: Function signatures are the API contract

---

## 6. Parsers

### 6.1 Zero CLI Output Parser

The Zero CLI outputs JSON when `--json` is passed. No HTML scraping needed.

```typescript
// Internal: parse zero check --json output
function parseCheckOutput(raw: string): ZeroCheckResult {
  const json = JSON.parse(raw);
  return {
    ok: json.ok ?? false,
    diagnostics: (json.diagnostics ?? []).map(parseDiagnostic),
    raw: json,
  };
}

function parseDiagnostic(d: Record<string, unknown>): ZeroDiagnostic {
  return {
    code: String(d.code ?? "UNK000"),
    severity: d.severity ?? "error",
    message: String(d.message ?? ""),
    line: Number(d.line ?? 0),
    column: d.column ? Number(d.column) : undefined,
    repair: d.repair ? { id: String(d.repair.id), suggestion: d.repair.suggestion ? String(d.repair.suggestion) : undefined } : undefined,
  };
}
```

### 6.2 Zero Function Signature Parser

When discovering tools from a Zero program via `zero graph --json`, we need to extract function names and their parameter types to build OpenAI function-calling schemas.

```typescript
// Internal: extract function signatures from graph output
function extractFunctionsFromGraph(graph: ZeroGraphResult): ZeroFunctionInfo[] {
  // The graph output includes exported function names.
  // We derive parameter schemas from the Zero type annotations
  // by parsing function declarations in the source.
  // ...
}
```

**v1 simplification**: We don't parse Zero signatures into JSON Schema automatically. Instead, `createZeroTool()` requires the caller to provide the `description` and the parameter schema matches the binary's stdin JSON contract. `compileAndRegister()` uses `zero graph` to discover function names but still requires human-provided descriptions.

---

## 7. Constants

```typescript
// Default configuration
const DEFAULT_COMPILER_BINARY = "zero";
const DEFAULT_COMPILER_TIMEOUT = 30_000; // ms
const DEFAULT_BUILD_TARGET = "linux-musl-x64";
const DEFAULT_VERIFY = true;
const TEMP_DIR = ".zero-origen/tmp";

// Zero diagnostic code patterns
const DIAGNOSTIC_CODE_PATTERN = /^[A-Z]{3}\d{3}$/;

// Exit codes from Zero CLI
const ZERO_EXIT_OK = 0;
const ZERO_EXIT_ERRORS = 1;
const ZERO_EXIT_INTERNAL = 2;
```

---

## 8. Error Handling

| Error | Cause | Recovery |
|---|---|---|
| `ZeroCompilerNotFoundError` | `zero` binary not on PATH or configured path | Install Zero CLI, configure `binaryPath` |
| `ZeroCheckFailedError` | Source has diagnostics (errors/warnings) | Return diagnostics to LLM for self-repair |
| `ZeroBuildFailedError` | Compilation produces no output binary | Check diagnostics, fix source |
| `ZeroTimeoutError` | Compiler invocation exceeds timeout | Increase `timeout` config or simplify source |
| `ZeroExecutionError` | Compiled binary returns non-zero exit | Return stderr as error message to LLM |

All errors extend a base `ZeroError`:

```typescript
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
```

### Error Flow in Agent Loop

When the LLM calls `zero_check` and gets errors:
1. The tool returns a structured string listing all diagnostics
2. The LLM sees the errors and can call `zero_fix` for repair suggestions
3. The LLM writes corrected source and calls `zero_check` again
4. Loop until `ok: true`, then optionally register the tool

This is the **verified code generation** loop — the compiler is the guardrail.

---

## 9. Testing Strategy

### Unit Tests

| Test | What It Validates |
|---|---|
| `ZeroCompiler.check()` with valid source | Returns `{ ok: true, diagnostics: [] }` |
| `ZeroCompiler.check()` with invalid source | Returns diagnostics with line numbers and repair IDs |
| `ZeroCompiler.graph()` | Returns adjacency list |
| `ZeroCompiler.size()` | Returns size map |
| `createZeroTool()` registration | Creates OrigenTool with correct name, description, parameters |
| `createZeroTool().execute()` with valid args | Spawns binary, pipes JSON stdin, returns stdout |
| `createZeroTool().execute()` with failing binary | Returns `Error: <stderr>` string |
| `createZeroCompilerTools()` | Returns 4 OrigenTools with correct JSON schemas |
| `compileAndRegister()` with valid source | Returns `{ tools: [...] }` |
| `compileAndRegister()` with invalid source | Returns `{ errors: [...] }` |
| Temp file cleanup | Files in `.zero-origen/tmp/` are cleaned after tool execution |

### Integration Tests

| Test | What It Validates |
|---|---|
| Full agent loop: check → fix → register | LLM writes Zero, checks, fixes, and registers in one conversation |
| `zero_check` tool called from Origen | Tool returns structured diagnostics to LLM |
| Compiled Zero binary as OrigenTool | Binary receives JSON args, returns string result |

### Skip Conditions

Tests that invoke `zero` CLI are skipped when the binary is not available (CI without Zero installed). Marked with `describe.skipIf(!hasZeroBinary)`.

---

## 10. Project Structure

```
origen-zero/
├── src/
│   ├── index.ts          # Re-exports public API
│   ├── compiler.ts       # ZeroCompiler class (check, graph, size, build, explain)
│   ├── tools.ts          # createZeroTool, createZeroToolsFromProgram, compileAndRegister
│   ├── compiler-tools.ts # createZeroCompilerTools (zero_check, zero_graph, zero_size, zero_fix)
│   ├── parser.ts         # Parse zero --json output into typed structures
│   ├── errors.ts         # ZeroError and subclasses
│   └── types.ts          # All TypeScript interfaces/types
├── test/
│   ├── compiler.test.ts  # ZeroCompiler unit tests
│   ├── tools.test.ts     # Tool registration and execution tests
│   ├── parser.test.ts    # Output parser tests
│   └── fixtures/
│       ├── hello.0        # Valid Zero source for testing
│       ├── broken.0       # Invalid Zero source with known errors
│       └── multi.0        # Multi-function Zero source for graph/size tests
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── README.md
```

---

## 11. Usage Examples

### Example 1: Register a Compiled Zero Program as OrigenTool

```typescript
import { createZeroTool } from "@moikapy/origen-zero/tools";
import { streamOrigen } from "@moikapy/origen";

const lookupTool = createZeroTool({
  functionName: "lookup",
  description: "Look up a Bible verse by reference",
  executablePath: "./bin/lookup",
});

const config = {
  appName: "Scholar",
  tools: [lookupTool],
  getD1: async () => myD1,
  model: "openrouter/free",
};

for await (const event of streamOrigen(messages, {}, config)) {
  // handle events
}
```

### Example 2: Let LLM Write and Check Zero Code

```typescript
import { createZeroCompilerTools } from "@moikapy/origen-zero/tools";
import { streamOrigen } from "@moikapy/origen";

const compilerTools = createZeroCompilerTools();

const config = {
  appName: "ZeroAgent",
  tools: [...compilerTools, ...myOtherTools],
  getD1: async () => myD1,
  model: "anthropic/claude-sonnet-4",
};

// The LLM can now:
// 1. Call zero_check({ source: "fun main() ..." }) to validate code
// 2. Call zero_fix({ source: "..." }) to get repair suggestions
// 3. Call zero_graph({ source: "..." }) to understand dependencies
// 4. Call zero_size({ source: "..." }) to estimate binary size
```

### Example 3: Write, Check, Fix, Register — Full Loop

```typescript
import { ZeroCompiler } from "@moikapy/origen-zero/compiler";
import { compileAndRegister } from "@moikapy/origen-zero/tools";

const source = `
  fun add(a: i32, b: i32) -> i32 => a + b
  
  pub fun main(world: World) -> Void raises {
    check world.out.write("hello\\n")
  }
`;

const result = await compileAndRegister({
  path: "math.0",
  content: source,
});

if ("tools" in result) {
  // ✅ Compiled cleanly — result.tools are ready to use with Origen
  console.log(`Registered ${result.tools.length} tools`);
} else {
  // ❌ Errors — return these to the LLM for self-repair
  console.log("Diagnostics:", result.errors);
}
```

---

## 12. Security & Ethics

### Subprocess Isolation

- Zero CLI invocations run in a subprocess with a configurable timeout
- Compiled Zero binaries also execute as subprocesses — they do NOT run in-process
- Both the CLI and compiled binaries receive input only via stdin (JSON args) and produce output only via stdout
- stderr is captured for error reporting but never executed

### Sandboxing Considerations

- v1: No sandboxing. The Zero CLI and compiled binaries run with the same permissions as the Origen process
- v2 (future): Use Cloudflare Sandbox SDK or docker isolation for compiled binary execution
- The `ZeroCompilerConfig.timeout` prevents infinite hangs
- Temp files are written to `.zero-origen/tmp/` and cleaned up after each tool execution

### Input Validation

- All source passed to `zero_check`/`zero_fix` tools is written to a temp file with a `.0` extension — never executed directly by the Node process
- JSON args passed to compiled Zero binaries are validated against the tool's parameter schema before spawning the subprocess
- The `zero_check` tool validates Zero source before any compilation attempt

### Prompt Injection

- Zero source code passed by the LLM is treated as **untrusted input** — it's written to a temp file and checked by the compiler, never eval'd
- Tool descriptions clearly state that `zero_check` returns compiler diagnostics, not executed output
- The `execute` path (running compiled binaries) only happens after successful compilation and explicit registration

---

## 13. Changelog & Versioning

- **v0.1.0** — Initial release
  - `ZeroCompiler` class (check, graph, size, build, explain)
  - `createZeroTool()` — register a compiled Zero function
  - `createZeroToolsFromProgram()` — discover and register all functions
  - `compileAndRegister()` — write, compile, verify, register in one call
  - `createZeroCompilerTools()` — interactive compiler tools for LLM

---

## 14. Dependencies

| Package | Version | Purpose |
|---|---|---|
| `@moikapy/origen` | ^0.6.0 | Peer dependency — provides `OrigenTool` type and agent loop |
| `zod` | ^4.0.0 | Runtime validation of Zero CLI output and tool inputs |
| `zero` CLI | latest | External binary — must be installed separately |

**Zero CLI availability**: This package does NOT bundle the Zero compiler. It must be installed separately via `curl -fsSL https://zerolang.ai/install.sh | bash` or equivalent. The `zero doctor --json` command can verify installation.

---

## Design Decisions

### Why a separate package, not built into Origen?

1. **Origen stays dependency-free on Zero** — Not every Origen user needs ZeroLang
2. **Zero CLI is an external binary** — It can't be a bundled `dep`
3. **Separate release cadence** — Zero is experimental; Origen is production

### Why subprocess execution, not in-process?

1. **Zero compiles to native code** — There's no WASM target yet (as of v1)
2. **Process isolation** — Compiled binaries can't crash the Origen process
3. **Explicit effects** — Zero's `raises` and `check` keywords mean the binary's behavior is predictable, but it's still foreign code
4. **Cloudflare Workers** — Won't support subprocess spawn. This package is for Node.js/Bun environments initially.

### Why not parse Zero signatures into JSON Schema automatically?

Zero's type system (i32, String, Result, World, etc.) doesn't have a 1:1 mapping to JSON Schema. v1 requires the caller to provide `description` and accept that parameter schemas match the binary's stdin JSON contract. Future versions may add Zero→JSON Schema derivation from `zero graph` output.

### Why `--json` and not parse human-readable output?

Because Zero's entire design philosophy is **agent-first tooling with structured output**. The `--json` flag produces machine-readable output. Parsing human-readable compiler messages would be fragile and defeat Zero's purpose.

---

## Success Criteria

1. **An LLM can write Zero code, check it, fix errors, and register it as a tool** — all within a single `streamOrigen` session
2. **A compiled Zero binary can be registered as an OrigenTool and execute correctly** when the LLM invokes it
3. **Compiler errors flow back to the LLM as structured tool results** — the LLM can read the diagnostic code, line number, and repair suggestion
4. **All tests pass** — unit and integration, with zero-CLI tests properly skipped when the binary isn't available
5. **TypeScript types are complete and exported** — `ZeroCompiler`, `ZeroCheckResult`, `ZeroDiagnostic`, `ZeroToolConfig`, etc.