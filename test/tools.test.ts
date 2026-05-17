import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createZeroTool, createZeroToolsFromProgram } from "../src/tools.js";
import type { OrigenTool } from "@moikapy/origen";

// Mock child_process.execFile for binary execution
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

// Mock ZeroCompiler to avoid needing Zero CLI
vi.mock("../src/compiler.js", () => ({
  ZeroCompiler: vi.fn().mockImplementation(() => ({
    check: vi.fn().mockResolvedValue({ ok: true, diagnostics: [] }),
    graph: vi.fn().mockResolvedValue({
      ok: true,
      graph: { add: [], multiply: [] },
    }),
    build: vi.fn().mockResolvedValue({
      ok: true,
      outputPath: "/tmp/test-binary",
      diagnostics: [],
    }),
  })),
}));

import { execFile } from "node:child_process";
const mockExecFile = vi.mocked(execFile);

describe("createZeroTool", () => {
  let tool: OrigenTool;

  beforeEach(() => {
    tool = createZeroTool({
      functionName: "add",
      description: "Add two numbers",
      execution: { mode: "subprocess", executablePath: "/bin/test-binary" },
      verify: false,
    });
  });

  it("creates a tool with correct name and description", () => {
    expect(tool.name).toBe("add");
    expect(tool.description).toBe("Add two numbers");
  });

  it("creates a tool with parameters object", () => {
    expect(tool.parameters).toBeDefined();
    expect((tool.parameters as any).type).toBe("object");
  });

  it("executes binary and returns stdout", async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: Function) => {
        cb(null, "42", "");
        return {} as any;
      },
    );

    const result = await tool.execute({ a: 1, b: 2 });
    expect(result).toBe("42");
  });

  it("returns error on non-zero exit code", async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: Function) => {
        const err = new Error("exit code 1") as NodeJS.ErrnoException & { status?: number };
        err.status = 1;
        cb(err, "", "Error: computation failed");
        return {} as any;
      },
    );

    // Should throw/reject for binary execution failures
    await expect(tool.execute({ a: 1, b: 2 })).rejects.toThrow();
  });

  describe("HTTP mode", () => {
    it("executes via HTTP and returns result", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve("42"),
      });

      const httpTool = createZeroTool({
        functionName: "add",
        description: "Add two numbers",
        execution: {
          mode: "http",
          endpoint: "https://zero-service.example.com",
          fetch: mockFetch,
        },
      });

      const result = await httpTool.execute({ a: 1, b: 2 });
      expect(result).toBe("42");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("throws ZeroHTTPError on non-2xx response", async () => {
      const { ZeroHTTPError } = await import("../src/errors.js");
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal Server Error"),
      });

      const httpTool = createZeroTool({
        functionName: "add",
        description: "Add two numbers",
        execution: {
          mode: "http",
          endpoint: "https://zero-service.example.com",
          fetch: mockFetch,
        },
      });

      await expect(httpTool.execute({ a: 1, b: 2 })).rejects.toThrow(ZeroHTTPError);
    });
  });
});

describe("createZeroToolsFromProgram", () => {
  it("discovers functions from graph and creates tools", async () => {
    const tools = await createZeroToolsFromProgram(
      { mode: "subprocess", executablePath: "/bin/test-binary" },
      { verify: false },
    );

    expect(tools).toHaveLength(2);
    expect(tools[0]!.name).toBe("add");
    expect(tools[1]!.name).toBe("multiply");
  });
});