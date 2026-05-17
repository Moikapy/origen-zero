import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ZeroCompiler } from "../src/compiler.js";
import {
  ZeroCompilerNotFoundError,
  ZeroTimeoutError,
} from "../src/errors.js";
import { execFile } from "node:child_process";

// Mock child_process.execFile
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

const mockExecFile = vi.mocked(execFile);

describe("ZeroCompiler", () => {
  let compiler: ZeroCompiler;

  beforeEach(() => {
    compiler = new ZeroCompiler({ binaryPath: "zero" });
    mockExecFile.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Helper to simulate execFile callback
  function mockSuccess(stdout: string): void {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: Function) => {
        cb(null, stdout, "");
        return {} as any;
      },
    );
  }

  function mockError(code: string, stderr: string): void {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: Function) => {
        const err = new Error(stderr) as NodeJS.ErrnoException & { status?: number };
        err.code = code as NodeJS.ErrnoException["code"];
        cb(err, "", stderr);
        return {} as any;
      },
    );
  }

  function mockExitWithErrors(stdout: string): void {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: Function) => {
        const err = new Error("exit code 1") as NodeJS.ErrnoException & { status?: number };
        err.status = 1;
        cb(err, stdout, "errors");
        return {} as any;
      },
    );
  }

  // ── check ──────────────────────────────────────────────────────────

  describe("check", () => {
    it("returns ok:true when source is valid", async () => {
      mockSuccess(JSON.stringify({ ok: true, diagnostics: [] }));
      const result = await compiler.check({ path: "test.0", content: "pub fun main() {}" });
      expect(result.ok).toBe(true);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("returns diagnostics when source has errors", async () => {
      mockExitWithErrors(JSON.stringify({
        ok: false,
        diagnostics: [
          { code: "TYP001", severity: "error", message: "Type mismatch", line: 5 },
        ],
      }));
      const result = await compiler.check({ path: "broken.0", content: "fun broken()" });
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]!.code).toBe("TYP001");
    });

    it("throws ZeroCompilerNotFoundError when binary is missing", async () => {
      mockError("ENOENT", "zero not found");
      await expect(compiler.check("test")).rejects.toThrow(ZeroCompilerNotFoundError);
    });
  });

  // ── graph ──────────────────────────────────────────────────────────

  describe("graph", () => {
    it("returns dependency graph", async () => {
      mockSuccess(JSON.stringify({
        schemaVersion: 1,
        symbols: [
          { name: "main", module: "multi", kind: "function", public: true, effects: [] },
          { name: "add", module: "multi", kind: "function", public: true, effects: [] },
        ],
        functions: [
          { name: "add", kind: "function", public: true, params: 2, returnType: "i32", raises: false, effects: [], allocationBehavior: "no heap allocation", targetSupport: { status: "supported", missingCapabilities: [] } },
          { name: "main", kind: "function", public: true, params: 1, returnType: "Void", raises: true, effects: ["io"], allocationBehavior: "no heap allocation", targetSupport: { status: "supported", missingCapabilities: [] } },
        ],
      }));
      const result = await compiler.graph({ path: "multi.0", content: "pub fun main() {}" });
      expect(result.ok).toBe(true);
      expect(result.functions.map((f: any) => f.name)).toContain("main");
    });
  });

  // ── size ────────────────────────────────────────────────────────────

  describe("size", () => {
    it("returns size estimates", async () => {
      mockSuccess(JSON.stringify({
        schemaVersion: 1,
        portableRuntime: {
          target: "linux-x64",
          runtimeKind: "native",
          portable: false,
          imports: { functionCount: 0, functions: [], module: null },
          memoryFloor: { floorBytes: 65536, minimumPages: 1 },
        },
      }));
      const result = await compiler.size({ path: "multi.0", content: "pub fun main() {}" });
      expect(result.ok).toBe(true);
      expect(result.portableRuntime?.target).toBe("linux-x64");
    });
  });

  // ── fix ────────────────────────────────────────────────────────────

  describe("fix", () => {
    it("returns fix suggestions", async () => {
      mockSuccess(JSON.stringify({
        ok: true,
        fixes: [
          { id: "repair-type", diagnosticCode: "TYP001", safety: "safe", summary: "Add type annotation", appliesEdits: true },
        ],
      }));
      const result = await compiler.fix({ path: "broken.0", content: "fun broken()" });
      expect(result.ok).toBe(true);
      expect(result.fixes).toHaveLength(1);
      expect(result.fixes[0]!.id).toBe("repair-type");
    });
  });

  // ── explain ────────────────────────────────────────────────────────

  describe("explain", () => {
    it("returns human-readable explanation", async () => {
      mockSuccess("TYP001: Type mismatch — the expression does not match the expected type.");
      const result = await compiler.explain("TYP001");
      expect(result).toContain("TYP001");
    });
  });

  // ── timeout ─────────────────────────────────────────────────────────

  describe("timeout", () => {
    it("throws ZeroTimeoutError when command exceeds timeout", async () => {
      // Use a compiler with very short timeout
      const fast = new ZeroCompiler({ timeout: 1 });

      // Simulate a hanging invocation by never calling the callback
      mockExecFile.mockImplementation(() => {
        // Never calls back — will timeout
        return {} as any;
      });

      await expect(fast.check("test")).rejects.toThrow(ZeroTimeoutError);
    });
  });
});