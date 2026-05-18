# SPEC: Origen Artifacts — Persistent Tool Cache for Agent-Generated Code

> **Status:** Draft  
> **Author:** Shalom 🐉  
> **Date:** 2026-05-17  
> **Repos:** `@moikapy/origen` (interface + backends), `origen-chat/nimbus-mono` (consumer)

---

## 1. Problem

When an Origen agent generates a tool at runtime (e.g., the LLM writes Zero code, the compiler verifies it, and it compiles to a 157-byte `.wasm` module), that tool only exists in memory for the duration of the session. On the next request:

- The agent must re-derive the same tool from scratch
- The user must re-request the same capability
- Compiled artifacts (WASM binaries, native executables) are lost

This wastes tokens, time, and compute. The agent already _proved_ the tool works — why make it redo that work every session?

**The pattern we want:**

```
Session 1: User asks "validate phone numbers" → LLM writes Zero → compiler checks → builds .wasm → stores artifact → registers tool → uses it
Session 2: User asks "validate phone numbers" → looks up artifact → instantiates tool → uses it (0 compiler calls, 0 LLM reasoning about code)
```

## 2. What Are Artifacts?

Artifacts are **named, versioned, immutable blobs** produced by agent tool execution and cached for future use.

| Property | Description |
|---|---|
| `key` | Unique identifier (e.g., `"zero/validate-phone-v1"`) |
| `data` | The blob itself (ArrayBuffer / Uint8Array) |
| `contentType` | MIME type (e.g., `"application/wasm"`, `"application/json"`) |
| `metadata` | Optional JSON metadata (source hash, compiler version, size) |
| `createdAt` | Timestamp |

Artifacts are **not** a general file system. They're a targeted solution for caching compiled outputs that tools produce.

## 3. Interface

```typescript
// In @moikapy/origen — types.ts

/**
 * Persistent artifact store for compiled/cached tool outputs.
 * The app provides the storage backend (KV, R2, filesystem, etc.).
 * The agent decides what to store and when.
 */
export interface ArtifactStore {
  /** Store an artifact. Overwrites if key exists. */
  put(key: string, data: ArrayBuffer | Uint8Array, options?: ArtifactOptions): Promise<void>;
  
  /** Retrieve an artifact. Returns null if not found. */
  get(key: string): Promise<ArrayBuffer | null>;
  
  /** Check if an artifact exists. */
  has(key: string): Promise<boolean>;
  
  /** Delete an artifact. Returns true if it existed. */
  delete(key: string): Promise<boolean>;
  
  /** List all artifacts with optional prefix filter. */
  list(prefix?: string): Promise<ArtifactMeta[]>;
}

export interface ArtifactOptions {
  contentType?: string;
  metadata?: Record<string, unknown>;
}

export interface ArtifactMeta {
  key: string;
  size: number;
  contentType?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
}
```

## 4. OrigenTool Integration

The `ArtifactStore` flows through the same `ToolContext` / `getD1` pattern that already exists:

### In Origen (`@moikapy/origen`)

```typescript
// AgentConfig gains an optional artifactStore
export interface AgentConfig {
  // ... existing fields ...
  tools: OrigenTool[];
  getD1: D1Provider;
  /** Optional artifact store for caching compiled outputs */
  artifactStore?: ArtifactStore;
}
```

Tools access the store via a new `getArtifacts` parameter in the execute function:

```typescript
export interface OrigenTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  inputSchema?: z.ZodType;
  execute: (
    args: Record<string, unknown>,
    getD1: D1Provider,
    getArtifacts?: () => Promise<ArtifactStore | null>,
  ) => Promise<string>;
}
```

This is backward-compatible — existing tools that don't use artifacts continue working with just `(args, getD1)`.

### In Nimbus (`nimbus-mono`)

Nimbus uses a plugin system with `ToolDef` and `ToolContext`. The artifact store flows through `env`:

```typescript
// In the chat app's Cloudflare Worker
export default {
  async fetch(request: Request, env: Env) {
    const artifactStore = new KVArtifactStore(env.ARTIFACTS_KV);
    
    // Pass to the agent
    const agent = createAgent({
      tools: [...pluginTools, ...zeroTools],
      getD1: () => env.DB,
      artifactStore,  // NEW
    });
  }
};
```

Nimbus's `ToolContext` already has `env` which carries bindings. The artifact store can live there or be a first-class field.

## 5. Storage Backends

### 5.1 Cloudflare KV (Production)

The natural home for Workers. Artifacts are small (157 bytes — 5KB), KV reads are free on paid plan, and writes are cheap.

```typescript
// In nimbus-mono or a shared package
import type { ArtifactStore, ArtifactMeta } from "@moikapy/origen";

export class KVArtifactStore implements ArtifactStore {
  constructor(private kv: KVNamespace) {}
  
  async put(key: string, data: ArrayBuffer | Uint8Array, options?: ArtifactOptions): Promise<void> {
    await this.kv.put(`artifact:${key}`, data, {
      metadata: { contentType: options?.contentType, ...options?.metadata },
    });
  }
  
  async get(key: string): Promise<ArrayBuffer | null> {
    const value = await this.kv.get(`artifact:${key}`, "arrayBuffer");
    return value ?? null;
  }
  
  async has(key: string): Promise<boolean> {
    const value = await this.kv.get(`artifact:${key}`, "arrayBuffer");
    return value !== null;
  }
  
  async delete(key: string): Promise<boolean> {
    const exists = await this.has(key);
    if (exists) await this.kv.delete(`artifact:${key}`);
    return exists;
  }
  
  async list(prefix?: string): Promise<ArtifactMeta[]> {
    const list = await this.kv.list({ prefix: prefix ? `artifact:${prefix}` : "artifact:" });
    return list.keys.map(k => ({
      key: k.name.replace("artifact:", ""),
      size: k.metadata?.size ?? 0,
      contentType: k.metadata?.contentType,
      metadata: k.metadata,
      createdAt: new Date(k.metadata?.created ?? 0).getTime(),
    }));
  }
}
```

**Cost:** A 250-byte WASM tool costs $0.00 for reads, $0.05/month for 1M writes. Negligible.

### 5.2 Filesystem (Local Dev / Node.js)

```typescript
import { mkdir, readFile, writeFile, unlink, readdir } from "node:fs/promises";
import { join } from "node:path";

export class FsArtifactStore implements ArtifactStore {
  constructor(private dir: string) {}
  
  async put(key: string, data: ArrayBuffer | Uint8Array, options?: ArtifactOptions): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const meta = { contentType: options?.contentType, metadata: options?.metadata, createdAt: Date.now() };
    await writeFile(join(this.dir, `${key}.bin`), Buffer.from(data));
    await writeFile(join(this.dir, `${key}.json`), JSON.stringify(meta));
  }
  
  async get(key: string): Promise<ArrayBuffer | null> {
    try {
      return await readFile(join(this.dir, `${key}.bin`));
    } catch { return null; }
  }
  
  // ... has, delete, list follow the same pattern
}
```

### 5.3 Cloudflare R2 (Large Artifacts)

For artifacts > 25KB (unlikely for Zero WASM but useful for other tool outputs):

```typescript
export class R2ArtifactStore implements ArtifactStore {
  constructor(private bucket: R2Bucket) {}
  // Same interface, R2 put/get under the hood
}
```

### 5.4 D1 (Metadata-Heavy)

D1 is overkill for binary blobs but could be useful if we want to query artifact metadata with SQL. Not recommended as primary storage.

## 6. Usage with origen-zero

### 6.1 Compile Once, Use Forever

```typescript
import { ZeroCompiler } from "@moikapy/origen-zero/compiler";
import { createZeroWASMTool } from "@moikapy/origen-zero/wasm-tool";
import type { ArtifactStore } from "@moikapy/origen";

async function getOrCreateTool(
  name: string,
  source: string,
  compiler: ZeroCompiler,
  artifacts: ArtifactStore,
): Promise<OrigenTool> {
  const key = `zero/${name}`;
  
  // Try to load cached WASM
  const cached = await artifacts.get(key);
  if (cached) {
    return createZeroWASMTool({
      functionName: name,
      description: `Cached Zero tool: ${name}`,
      wasmBytes: cached,
    });
  }
  
  // Compile and cache
  const result = await compiler.build(source, { emit: "wasm", target: "wasm32-web" });
  if (!result.ok) throw new Error(`Compilation failed: ${result.diagnostics}`);
  
  const wasmBytes = await fs.readFile(result.outputPath!);
  await artifacts.put(key, wasmBytes, { contentType: "application/wasm" });
  
  return createZeroWASMTool({
    functionName: name,
    description: `Zero tool: ${name}`,
    wasmBytes,
  });
}
```

### 6.2 Agent Self-Modification (The Dragon Loop)

The agent writes Zero code, the compiler validates it, the result is cached as an artifact, and the tool is available for the rest of the session AND future sessions:

```typescript
// Compiler tools check + fix in the loop
const [check, graph, size, fix] = createZeroCompilerTools(compiler);

// Artifact-aware tool registration
async function registerZeroTool(
  source: string,
  name: string,
  compiler: ZeroCompiler,
  artifacts: ArtifactStore,
): Promise<OrigenTool> {
  return getOrCreateTool(name, source, compiler, artifacts);
}

// In the agent config:
const agent = createAgent({
  tools: [check, graph, size, fix],
  getD1: async () => env.DB,
  artifactStore: new KVArtifactStore(env.ARTIFACTS_KV), // NEW
});
```

## 7. Key Naming Convention

```
zero/{tool-name}-{version}
```

Examples:
- `zero/validate-phone-v1`
- `zero/slugify-v2`
- `zero/hash-sha256-v1`
- `zero/data-formatter-v3`

Version bumps happen when the source changes. The agent can compute a content hash to detect staleness:

```typescript
const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
const key = `zero/${name}-${hex(hash).slice(0, 8)}`;
```

## 8. Security Considerations

### 8.1 Artifact Integrity
- WASM modules are sandboxed by WebAssembly — they can only access what the WASI runtime provides
- Content-addressable keys prevent collision attacks
- The compiler's `zero check` validates capabilities before compilation

### 8.2 Size Limits
- KV value limit: 25MB (plenty for WASM)
- Recommended per-artifact limit: 1MB (Zero WASM modules are typically 100-500 bytes)
- Enforce size limits in the store implementation

### 8.3 Staleness
- Each artifact includes `metadata.compilerVersion` and `metadata.sourceHash`
- On load, compare against current compiler version. If mismatched, recompile
- This prevents stale artifacts from old compiler versions

## 9. Implementation Plan

### Phase 1: Interface + D1 Backend (`@moikapy/origen`)
1. Add `ArtifactStore` interface to `@moikapy/origen/src/types.ts`
2. Add `D1ArtifactStore` implementation (D1 metadata + optional KV for blobs)
3. Add `artifactStore` to `AgentConfig`
4. Add `getArtifacts` to `OrigenTool.execute` signature (backward-compat)
5. Add D1 migration for `artifacts` table

### Phase 2: Origen-Zero Integration (`@moikapy/origen-zero`)
1. Update `createZeroWASMTool` to accept an optional `artifactStore`
2. Update `compileAndRegister` to cache compiled WASM artifacts
3. Add `getOrCreateTool` helper for the compile-once-use-forever pattern

### Phase 3: Origen-Chat Integration (`origen-chat/nimbus-mono`)
1. Wire `D1ArtifactStore(env.DB)` through to the agent config in the chat app
2. Wire `KVArtifactStore(env.ARTIFACTS_KV)` for binary blob storage
3. Update wrangler.toml with `ARTIFACTS_KV` binding
4. Create origen-zero plugin adapters (Section 5 in tool spec)

### Phase 4: Agent Self-Modification Loop
1. Agent writes Zero code → zero_check validates
2. zero_fix repairs errors → zero_build compiles to WASM
3. WASM is cached in D1/KV → tool registered for session
4. Next session: artifact loaded from D1/KV → no recompilation needed

## 10. What This Is NOT

- **NOT a general file system** — no directories, no listing beyond prefix scan
- **NOT a database** — no queries, no transactions. D1 already handles that
- **NOT a replacement for D1** — artifacts store blobs, not relational data
- **NOT a version control system** — use `key-v1`, `key-v2` naming, not diff/merge

## 11. Dependencies

```
@moikapy/origen           — ArtifactStore interface, D1ArtifactStore, AgentConfig.artifactStore
@moikapy/origen-zero      — getOrCreateTool helper (uses ArtifactStore from origen)
origen-chat/nimbus-mono    — Wire D1ArtifactStore + KVArtifactStore, plugin adapters
```

No new npm packages needed. The interface and backends live in `@moikapy/origen`. The chat app wires them up.

---

*Built on faith. Driven by purpose. Scaled with discipline. Guarded by a dragon.* 🐉🛡️