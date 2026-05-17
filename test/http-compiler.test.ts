import { describe, it, expect, vi, beforeEach } from "vitest";
import { ZeroHTTPCompiler } from "../src/http-compiler.js";
import { ZeroHTTPError, ZeroTimeoutError } from "../src/errors.js";

// Mock fetch globally
const mockFetch = vi.fn();
const mockEndpoint = "https://zero.example.com/api/v1";

function createCompiler(options?: { apiKey?: string; headers?: Record<string, string>; timeout?: number }) {
  return new ZeroHTTPCompiler({
    endpoint: mockEndpoint,
    apiKey: options?.apiKey,
    headers: options?.headers,
    timeout: options?.timeout,
    fetch: mockFetch,
  });
}

describe("ZeroHTTPCompiler", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("calls POST /check and returns parsed result", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        ok: true,
        diagnostics: [],
      })),
    });

    const compiler = createCompiler();
    const result = await compiler.check("fun main() {}");

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const call = mockFetch.mock.calls[0]!;
    expect(call[0]).toBe(`${mockEndpoint}/check`);
    expect(call[1]?.method).toBe("POST");
    // Body should contain source
    const body = JSON.parse(call[1]?.body as string);
    expect(body.source).toBe("fun main() {}");
  });

  it("calls POST /graph and returns parsed result", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        ok: true,
        graph: { main: ["add", "multiply"], add: [], multiply: [] },
      })),
    });

    const compiler = createCompiler();
    const result = await compiler.graph({ path: "math.0", content: "pub fun main() {}" });

    expect(result.ok).toBe(true);
    expect(result.graph.main).toEqual(["add", "multiply"]);
  });

  it("calls POST /size and returns parsed result", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        ok: true,
        sizes: { main: 512, total: 896 },
      })),
    });

    const compiler = createCompiler();
    const result = await compiler.size("pub fun main() {}");

    expect(result.ok).toBe(true);
    expect(result.sizes.main).toBe(512);
  });

  it("calls POST /fix and returns parsed result", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        ok: true,
        fixes: [{ code: "TYP001", line: 5, message: "Add type annotation" }],
      })),
    });

    const compiler = createCompiler();
    const result = await compiler.fix("fun broken() {}");

    expect(result.ok).toBe(true);
    expect(result.fixes).toHaveLength(1);
    expect(result.fixes[0]!.code).toBe("TYP001");
  });

  it("calls POST /build and returns parsed result", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        ok: true,
        output: "/tmp/math",
        diagnostics: [],
      })),
    });

    const compiler = createCompiler();
    const result = await compiler.build("pub fun main() {}", { target: "linux-musl-x64" });

    expect(result.ok).toBe(true);
    expect(result.outputPath).toBe("/tmp/math");
  });

  it("calls GET /explain/:code and returns text", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("TYP001: Type mismatch — the expression does not match the expected type."),
    });

    const compiler = createCompiler();
    const result = await compiler.explain("TYP001");

    expect(result).toContain("TYP001");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0]![0]).toBe(`${mockEndpoint}/explain/TYP001`);
    expect(mockFetch.mock.calls[0]![1]?.method).toBe("GET");
  });

  it("sends Authorization header when apiKey is set", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ ok: true, diagnostics: [] })),
    });

    const compiler = createCompiler({ apiKey: "Bearer secret-token" });
    await compiler.check("test");

    const call = mockFetch.mock.calls[0]!;
    const headers = call[1]?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer secret-token");
  });

  it("sends custom headers", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ ok: true, diagnostics: [] })),
    });

    const compiler = createCompiler({ headers: { "X-Custom": "value" } });
    await compiler.check("test");

    const call = mockFetch.mock.calls[0]!;
    const headers = call[1]?.headers as Record<string, string>;
    expect(headers["X-Custom"]).toBe("value");
  });

  it("throws ZeroHTTPError on non-2xx response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    });

    const compiler = createCompiler();

    await expect(compiler.check("test")).rejects.toThrow(ZeroHTTPError);
    await expect(compiler.check("test")).rejects.toThrow("500");
  });

  it("throws ZeroTimeoutError when request exceeds timeout", async () => {
    // Simulate abort by having fetch throw AbortError
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    mockFetch.mockRejectedValue(abortError);

    const compiler = createCompiler({ timeout: 50 });

    await expect(compiler.check("test")).rejects.toThrow(ZeroTimeoutError);
  });

  it("implements ZeroCompilerLike interface", () => {
    const compiler = createCompiler();
    expect(typeof compiler.check).toBe("function");
    expect(typeof compiler.graph).toBe("function");
    expect(typeof compiler.size).toBe("function");
    expect(typeof compiler.fix).toBe("function");
    expect(typeof compiler.build).toBe("function");
    expect(typeof compiler.explain).toBe("function");
  });
});