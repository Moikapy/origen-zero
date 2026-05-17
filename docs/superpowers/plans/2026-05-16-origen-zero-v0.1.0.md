# Plan: @moikapy/origen-zero v0.1.0

**Date**: 2026-05-16
**Status**: In Progress

## Overview

Bridge package connecting Origen agents to ZeroLang's compiler and runtime. Agents write `.0` files, check them, fix them, and register compiled programs as OrigenTools — all within a single conversation session.

## File Structure

```
origen-zero/
├── src/
│   ├── index.ts          # Re-exports public API
│   ├── compiler.ts       # ZeroCompiler class
│   ├── tools.ts           # createZeroTool, createZeroToolsFromProgram, compileAndRegister
│   ├── compiler-tools.ts  # createZeroCompilerTools (zero_check, zero_graph, zero_size, zero_fix)
│   ├── parser.ts          # Parse Zero CLI --json output
│   ├── errors.ts          # ZeroError hierarchy
│   └── types.ts           # TypeScript interfaces/types
├── test/
│   ├── compiler.test.ts
│   ├── tools.test.ts
│   ├── parser.test.ts
│   └── fixtures/
│       ├── hello.0
│       ├── broken.0
│       └── multi.0
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── README.md
```

## Tasks (in order)

### Task 1: Project scaffolding
- [x] Create package.json with exports map, peerDeps, scripts
- [x] Create tsconfig.json
- [x] Create tsup.config.ts matching Origen's pattern
- [x] Install dependencies (zod, vitest, typescript, tsup)
- [x] Verify `bun run build` succeeds with empty entrypoints

### Task 2: Types & errors (types.ts, errors.ts)
- [x] Write all interfaces from SPEC §3 (ZeroCompilerConfig, ZeroDiagnostic, ZeroCheckResult, etc.)
- [x] Write ZeroError, ZeroCompilerNotFoundError, ZeroTimeoutError, etc.
- [x] Write tests for error hierarchy
- [x] Verify all types export cleanly from index.ts

### Task 3: Parser (parser.ts)
- [x] Write ZeroCheckResultSchema, ZeroGraphResultSchema, ZeroSizeResultSchema (Zod)
- [x] Write parseCheckOutput, parseDiagnostic, parseGraphOutput, parseSizeOutput
- [x] Write tests with mock JSON outputs
- [x] Verify tests pass

### Task 4: Compiler (compiler.ts)
- [x] Write ZeroCompiler class with check, graph, size, build, explain
- [x] Each method spawns `zero` CLI subprocess with --json flag
- [x] Timeout handling via ZeroCompilerConfig.timeout
- [x] Binary not found → ZeroCompilerNotFoundError
- [x] All methods parse output through parser.ts
- [x] Write tests (mock subprocess execution)
- [x] Verify tests pass

### Task 5: Tool registration (tools.ts)
- [x] Write createZeroTool — registers a compiled Zero function as OrigenTool
- [x] Write createZeroToolsFromProgram — discovers functions via `zero graph`
- [x] Write compileAndRegister — write source, compile, verify, register
- [x] Tool execution spawns binary, pipes JSON via stdin, captures stdout
- [x] Write tests (mock subprocess for binary execution)
- [x] Verify tests pass

### Task 6: Interactive compiler tools (compiler-tools.ts)
- [x] Write createZeroCompilerTools — returns 4 OrigenTools
- [x] zero_check, zero_graph, zero_size, zero_fix
- [x] Each tool writes source to temp file, invokes CLI, parses result, cleans up
- [x] Write tests (mock CLI calls)
- [x] Verify tests pass

### Task 7: Integration & exports
- [x] Wire up index.ts re-exports for all 3 entry points (./, ./tools, ./compiler)
- [x] Verify build succeeds with all exports
- [x] Verify typecheck passes
- [x] Skip-condition logic for tests requiring `zero` binary

### Task 8: Ship
- [ ] Run full test suite
- [ ] Typecheck clean
- [ ] Build clean
- [ ] npm_verify_build
- [ ] Commit