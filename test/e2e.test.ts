/**
 * End-to-end integration tests using Zero CLI built from source.
 *
 * These tests run REAL Zero CLI commands and REAL WASM execution.
 * They require the Zero repo at ~/code/zero-zero with `make -C native/zero-c` run.
 *
 * Run with: ZERO_BIN=/path/to/zero npx vitest run test/e2e.test.ts
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ZeroCompiler } from "../src/compiler.js";
import { createZeroWASMTool } from "../src/wasm-tool.js";

const execFileAsync = promisify(execFile);
const FIXTURES = join(import.meta.dirname, "fixtures");

// Resolve Zero binary: env var > from-source build > installed binary
const ZERO_BIN = process.env.ZERO_BIN
  || (existsSync(join(process.env.HOME!, "code/zero-zero/bin/zero"))
    ? join(process.env.HOME!, "code/zero-zero/bin/zero")
    : "zero");

const hasZero = await execFileAsync(ZERO_BIN, ["--version"])
  .then(() => true)
  .catch(() => false);

describe.skipIf(!hasZero)("E2E: Zero CLI from source", () => {
  let compiler: ZeroCompiler;

  beforeAll(() => {
    compiler = new ZeroCompiler({
      binaryPath: ZERO_BIN,
      timeout: 10000,
    });
  });

  // ── Check ──────────────────────────────────────────────────────────

  describe("check", () => {
    it("passes for valid hello.0", async () => {
      const result = await compiler.check(join(FIXTURES, "hello.0"));
      expect(result.ok).toBe(true);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("passes for valid multi.0", async () => {
      const result = await compiler.check(join(FIXTURES, "multi.0"));
      expect(result.ok).toBe(true);
    });

    it("reports errors for broken.0", async () => {
      const result = await compiler.check(join(FIXTURES, "broken.0"));
      expect(result.ok).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThan(0);
      // PAR100 = parser error
      expect(result.diagnostics[0]!.code).toMatch(/PAR\d{3}|CHK\d{3}|TYP\d{3}|NAM\d{3}/);
    });
  });

  // ── Graph ──────────────────────────────────────────────────────────

  describe("graph", () => {
    it("returns function graph for multi.0", async () => {
      const result = await compiler.graph(join(FIXTURES, "multi.0"));
      expect(result.ok).toBe(true);
      // Should list our functions
      const names = result.functions.map((f: any) => f.name);
      expect(names).toContain("add");
      expect(names).toContain("multiply");
      expect(names).toContain("main");
    });
  });

  // ── Size ───────────────────────────────────────────────────────────

  describe("size", () => {
    it("returns size estimates for hello.0", async () => {
      const result = await compiler.size(join(FIXTURES, "hello.0"));
      expect(result.ok).toBe(true);
    });
  });

  // ── Build native ───────────────────────────────────────────────────

  describe("build", () => {
    it("builds native executable for hello.0", async () => {
      const outPath = join(FIXTURES, ".zero-out", "hello-exe");
      const result = await compiler.build(join(FIXTURES, "hello.0"), {
        emit: "exe",
        out: outPath,
      });
      expect(result.ok).toBe(true);
      expect(result.outputPath).toBeDefined();
    });

    it("builds WASM module for hello.0", async () => {
      const outPath = join(FIXTURES, ".zero-out", "hello-wasm");
      const result = await compiler.build(join(FIXTURES, "hello.0"), {
        emit: "wasm",
        target: "wasm32-web",
        out: outPath,
      });
      expect(result.ok).toBe(true);
      // Verify the WASM file exists and is valid
      const wasmPath = `${outPath}.wasm`;
      expect(existsSync(wasmPath)).toBe(true);
      const bytes = readFileSync(wasmPath);
      // WASM magic header: \0asm
      expect(bytes[0]).toBe(0x00);
      expect(bytes[1]).toBe(0x61); // 'a'
      expect(bytes[2]).toBe(0x73); // 's'
      expect(bytes[3]).toBe(0x6d); // 'm'
    });

    it("builds WASM module for multi.0", async () => {
      const outPath = join(FIXTURES, ".zero-out", "multi-wasm");
      const result = await compiler.build(join(FIXTURES, "multi.0"), {
        emit: "wasm",
        target: "wasm32-web",
        out: outPath,
      });
      expect(result.ok).toBe(true);
      const wasmPath = `${outPath}.wasm`;
      expect(existsSync(wasmPath)).toBe(true);
    });
  });

  // ── Full pipeline: build WASM → execute ────────────────────────────

  describe("full pipeline: compile → WASM → execute", () => {
    it("compiles hello.0 to WASM and runs it in-process", async () => {
      const outPath = join(FIXTURES, ".zero-out", "pipeline-hello");
      await compiler.build(join(FIXTURES, "hello.0"), {
        emit: "wasm",
        target: "wasm32-web",
        out: outPath,
      });

      const wasmBytes = readFileSync(`${outPath}.wasm`);
      const ab = wasmBytes.buffer.slice(
        wasmBytes.byteOffset,
        wasmBytes.byteOffset + wasmBytes.byteLength,
      ) as ArrayBuffer;

      const tool = createZeroWASMTool({
        functionName: "hello",
        description: "Hello from pipeline",
        wasmBytes: ab,
      });

      const result = await tool.execute({});
      expect(result).toContain("hello");
    });

    it("compiles add.0 to WASM and runs it in-process", async () => {
      const addSrc = join(FIXTURES, "add.0");
      // Build add.0 WASM
      const outPath = join(FIXTURES, ".zero-out", "pipeline-add");
      await compiler.build(addSrc, {
        emit: "wasm",
        target: "wasm32-web",
        out: outPath,
      });

      const wasmBytes = readFileSync(`${outPath}.wasm`);
      const ab = wasmBytes.buffer.slice(
        wasmBytes.byteOffset,
        wasmBytes.byteOffset + wasmBytes.byteLength,
      ) as ArrayBuffer;

      const tool = createZeroWASMTool({
        functionName: "add",
        description: "Add numbers",
        wasmBytes: ab,
      });

      const result = await tool.execute({});
      expect(result).toContain("42");
    });
  });

  // ── Compiler tools (Origen integration) ────────────────────────────

  describe("compiler tools for Origen", () => {
    it("creates 4 compiler tools from ZeroCompiler instance", async () => {
      const { createZeroCompilerTools } = await import("../src/compiler-tools.js");
      const tools = createZeroCompilerTools(compiler);
      expect(tools).toHaveLength(4);
      expect(tools.map((t: any) => t.name).sort()).toEqual([
        "zero_check",
        "zero_fix",
        "zero_graph",
        "zero_size",
      ]);
    });

    it("zero_check tool validates source via Origen tool interface", async () => {
      const { createZeroCompilerTools } = await import("../src/compiler-tools.js");
      const tools = createZeroCompilerTools(compiler);
      const checkTool = tools.find((t: any) => t.name === "zero_check")!;
      const result = await checkTool.execute(
        { source: join(FIXTURES, "hello.0") },
        async () => null as any,
      );
      // The result is a formatted check message
      expect(result).toContain("passed");
    });
  });
});