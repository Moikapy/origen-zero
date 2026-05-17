import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createZeroWASMTool, createZeroWASMTools } from "../src/wasm-tool.js";

const FIXTURES = join(import.meta.dirname, "fixtures");

function loadWasm(name: string): ArrayBuffer {
  const path = join(FIXTURES, `${name}.wasm`);
  const buf = readFileSync(path);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

describe("createZeroWASMTool", () => {
  it("creates a tool with correct name and description", () => {
    const wasmBytes = loadWasm("hello");
    const tool = createZeroWASMTool({
      functionName: "greet",
      description: "Say hello from Zero",
      wasmBytes,
    });

    expect(tool.name).toBe("greet");
    expect(tool.description).toBe("Say hello from Zero");
    expect(tool.parameters).toBeDefined();
  });

  it("executes hello.wasm and captures stdout", async () => {
    const wasmBytes = loadWasm("hello");
    const tool = createZeroWASMTool({
      functionName: "hello",
      description: "Hello from Zero",
      wasmBytes,
    });

    const result = await tool.execute({});
    expect(result).toContain("hello from zero");
  });

  it("executes add.wasm and captures stdout", async () => {
    const wasmBytes = loadWasm("add");
    const tool = createZeroWASMTool({
      functionName: "add",
      description: "Add two numbers",
      wasmBytes,
    });

    const result = await tool.execute({});
    expect(result).toContain("math works");
  });

  it("handles WebAssembly.Module input (pre-compiled)", async () => {
    const wasmBytes = loadWasm("hello");
    const module = await WebAssembly.compile(wasmBytes);
    const tool = createZeroWASMTool({
      functionName: "hello",
      description: "Hello from Zero",
      wasmBytes: module,
    });

    const result = await tool.execute({});
    expect(result).toContain("hello from zero");
  });

  it("caches compiled modules for reuse", async () => {
    const wasmBytes = loadWasm("hello");

    // Create two tools from the same WASM bytes
    const tool1 = createZeroWASMTool({
      functionName: "hello1",
      description: "Hello 1",
      wasmBytes,
    });
    const tool2 = createZeroWASMTool({
      functionName: "hello2",
      description: "Hello 2",
      wasmBytes,
    });

    // Both should work (module compiled once, cached)
    const result1 = await tool1.execute({});
    const result2 = await tool2.execute({});
    expect(result1).toContain("hello from zero");
    expect(result2).toContain("hello from zero");
  });
});

describe("createZeroWASMTools", () => {
  it("creates tool array from WASM module", () => {
    const wasmBytes = loadWasm("hello");
    const tools = createZeroWASMTools(wasmBytes);
    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe("main");
  });

  it("creates tools with custom descriptions", () => {
    const wasmBytes = loadWasm("hello");
    const tools = createZeroWASMTools(wasmBytes, {
      descriptions: { main: "Custom hello tool" },
    });
    expect(tools[0]!.description).toBe("Custom hello tool");
  });
});