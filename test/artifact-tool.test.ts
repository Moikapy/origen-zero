import { describe, it, expect, vi, beforeEach } from "vitest";
import { getOrCreateTool } from "../src/artifact-tool.js";
import type { ArtifactStore } from "@moikapy/origen";

// ── Mock ArtifactStore ──────────────────────────────────────────────────

function createMockArtifactStore(): ArtifactStore & { store: Map<string, ArrayBuffer> } {
  const store = new Map<string, ArrayBuffer>();
  return {
    store,
    async put(key: string, data: ArrayBuffer, options?: any): Promise<void> {
      store.set(key, data);
    },
    async get(key: string): Promise<ArrayBuffer | null> {
      return store.get(key) ?? null;
    },
    async has(key: string): Promise<boolean> {
      return store.has(key);
    },
    async delete(key: string): Promise<boolean> {
      return store.delete(key);
    },
    async list(prefix?: string): Promise<any[]> {
      return Array.from(store.keys())
        .filter((k) => !prefix || k.startsWith(prefix))
        .map((key) => ({ key, contentType: "application/wasm", size: 0, sourceHash: "", createdAt: 0, updatedAt: 0 }));
    },
  };
}

// ── Minimal WASM module that returns 0 from main() ──────────────────────
// This is a valid wasm32-web module: exports memory + main
const MINIMAL_WASM = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, // magic
  0x01, 0x00, 0x00, 0x00, // version
  // Type section: () -> i32
  0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7f,
  // Function section: type 0
  0x03, 0x02, 0x01, 0x00,
  // Export section: "main" -> func 0
  0x07, 0x08, 0x01, 0x04, 0x6d, 0x61, 0x69, 0x6e, 0x00, 0x00,
  // Code section: i32.const 0, end
  0x0a, 0x06, 0x01, 0x04, 0x00, 0x41, 0x00, 0x0b,
]).buffer.slice(0);

describe("getOrCreateTool", () => {
  let artifactStore: ReturnType<typeof createMockArtifactStore>;

  beforeEach(() => {
    artifactStore = createMockArtifactStore();
  });

  it("creates a tool and stores it in the artifact store", async () => {
    const tool = await getOrCreateTool({
      name: "validate-phone",
      wasmBytes: MINIMAL_WASM,
      artifactStore,
      source: "pub fun main() {}",
    });

    expect(tool.name).toBe("validate-phone");
    expect(tool.description).toBe("Zero tool: validate-phone");

    // Should have stored the WASM bytes
    const keys = Array.from(artifactStore.store.keys());
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^zero\/validate-phone-[a-f0-9]{12}$/);
    expect(artifactStore.store.get(keys[0]!)!.byteLength).toBe(MINIMAL_WASM.byteLength);
  });

  it("returns cached artifact on second call", async () => {
    const source = "pub fun main() { return 0 }";

    // First call — stores and returns
    const tool1 = await getOrCreateTool({
      name: "greet",
      wasmBytes: MINIMAL_WASM,
      artifactStore,
      source,
    });
    expect(tool1.name).toBe("greet");

    // Second call — should hit cache (same source = same key)
    const tool2 = await getOrCreateTool({
      name: "greet",
      wasmBytes: new ArrayBuffer(0), // Different bytes — should be ignored (cache hit)
      artifactStore,
      source,
    });
    expect(tool2.name).toBe("greet");

    // Store should still have exactly 1 entry (no duplicate put)
    expect(artifactStore.store.size).toBe(1);
  });

  it("generates different keys for different sources", async () => {
    const tool1 = await getOrCreateTool({
      name: "fn-a",
      wasmBytes: MINIMAL_WASM,
      artifactStore,
      source: "pub fun a() {}",
    });

    const tool2 = await getOrCreateTool({
      name: "fn-b",
      wasmBytes: MINIMAL_WASM,
      artifactStore,
      source: "pub fun b() {}",
    });

    // Two different sources = two different cache keys
    expect(artifactStore.store.size).toBe(2);
    const keys = Array.from(artifactStore.store.keys());
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("accepts ZeroSourceFile with path and content", async () => {
    const tool = await getOrCreateTool({
      name: "from-file",
      wasmBytes: MINIMAL_WASM,
      artifactStore,
      source: { path: "main.0", content: "pub fun main() {}" },
    });

    expect(tool.name).toBe("from-file");
    expect(artifactStore.store.size).toBe(1);
  });

  it("accepts custom tool config", async () => {
    const tool = await getOrCreateTool({
      name: "custom",
      wasmBytes: MINIMAL_WASM,
      artifactStore,
      source: "pub fun main() {}",
      toolConfig: {
        description: "Custom description",
        parameters: {
          type: "object",
          properties: { input: { type: "string" } },
          required: ["input"],
        },
      },
    });

    expect(tool.description).toBe("Custom description");
    expect((tool.parameters as any).type).toBe("object");
  });

  it("forces re-storage when forceRecompile is true", async () => {
    const source = "pub fun main() {}";

    // First call
    await getOrCreateTool({
      name: "force-test",
      wasmBytes: MINIMAL_WASM,
      artifactStore,
      source,
    });
    expect(artifactStore.store.size).toBe(1);

    // Force re-storage with different bytes
    const newBytes = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]).buffer.slice(0);
    await getOrCreateTool({
      name: "force-test",
      wasmBytes: newBytes,
      artifactStore,
      source,
      forceRecompile: true,
    });

    // Should have overwritten the cache entry (same key)
    expect(artifactStore.store.size).toBe(1);
    // The stored value should be the NEW bytes
    const key = Array.from(artifactStore.store.keys())[0]!;
    expect(artifactStore.store.get(key)!.byteLength).toBe(newBytes.byteLength);
  });

  it("passes compiler version to artifact metadata", async () => {
    // The mock store doesn't validate options, but we can verify
    // that getOrCreateTool calls put with the right args
    const putSpy = vi.spyOn(artifactStore, "put");

    await getOrCreateTool({
      name: "versioned",
      wasmBytes: MINIMAL_WASM,
      artifactStore,
      source: "pub fun main() {}",
      compilerVersion: "wasm32-wasi",
    });

    expect(putSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(ArrayBuffer),
      expect.objectContaining({
        compilerVersion: "wasm32-wasi",
        contentType: "application/wasm",
      }),
    );

    putSpy.mockRestore();
  });
});