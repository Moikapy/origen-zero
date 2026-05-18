/**
 * @moikapy/origen-zero — Artifact-aware tool creation
 *
 * The getOrCreateTool helper checks the artifact store for a cached WASM
 * module before using provided bytes. If the artifact exists and the source
 * hash matches, it reuses the cached bytes. If not, it stores the provided
 * bytes for future sessions.
 *
 * This is the "compile once, use forever" pattern that makes Zero tools
 * practical in production — no recompilation across sessions.
 *
 * The caller is responsible for obtaining WASM bytes (via ZeroCompiler,
 * ZeroHTTPCompiler, or any other method). getOrCreateTool handles caching.
 */

import type { ArtifactStore } from "@moikapy/origen";
import type { ZeroSourceFile } from "./types.js";
import { createZeroWASMTool, type ZeroWASMToolConfig } from "./wasm-tool.js";
import type { OrigenTool } from "@moikapy/origen";

// ── Options ─────────────────────────────────────────────────────────────

export interface GetOrCreateToolOptions {
  /** Name for the tool (used as artifact key prefix and function name). */
  name: string;
  /** The compiled WASM bytes. If the artifact store has a cache hit, this is skipped. */
  wasmBytes: ArrayBuffer;
  /** Artifact store for caching compiled WASM. */
  artifactStore: ArtifactStore;
  /** Zero source code (used to derive the content hash for cache key). */
  source: string | ZeroSourceFile;
  /** Custom WASM tool config overrides (description, parameters, runtimeConfig). */
  toolConfig?: Partial<Pick<ZeroWASMToolConfig, "description" | "parameters" | "runtimeConfig">>;
  /** Content type for the artifact. Default: "application/wasm". */
  contentType?: string;
  /** Whether to force re-storage even if cached. Default: false. */
  forceRecompile?: boolean;
  /** Compiler version tag for cache invalidation. Default: "wasm32-web". */
  compilerVersion?: string;
}

// ── getOrCreateTool ─────────────────────────────────────────────────────

/**
 * Get or create a Zero WASM tool, using the artifact store as a cache.
 *
 * 1. Compute source hash → derive artifact key
 * 2. Check artifact store for cached WASM bytes
 * 3. If cached and hash matches → instantiate from cached bytes
 * 4. If cache miss → store provided bytes → instantiate
 *
 * The caller is responsible for compilation. This function handles caching
 * and instantiation, so it works in any environment (Workers, Node, Bun).
 */
export async function getOrCreateTool(
  options: GetOrCreateToolOptions,
): Promise<OrigenTool> {
  const {
    name,
    wasmBytes,
    artifactStore,
    source,
    toolConfig,
    contentType = "application/wasm",
    forceRecompile = false,
    compilerVersion = "wasm32-web",
  } = options;

  // Derive a content-addressable key from the source
  const sourceString = typeof source === "string" ? source : source.content ?? "";
  const sourceHash = await hashSource(sourceString);
  const key = `zero/${name}-${sourceHash.slice(0, 12)}`;

  // Step 1: Check cache (skip if forceRecompile)
  if (!forceRecompile) {
    const cached = await artifactStore.get(key);
    if (cached) {
      return createZeroWASMTool({
        functionName: name,
        description: toolConfig?.description ?? `Zero tool: ${name}`,
        wasmBytes: cached,
        parameters: toolConfig?.parameters,
        runtimeConfig: toolConfig?.runtimeConfig,
      });
    }
  }

  // Step 2: Store the WASM bytes in the artifact cache
  await artifactStore.put(key, wasmBytes, {
    contentType,
    sourceHash,
    compilerVersion,
  });

  // Step 3: Create and return the tool
  return createZeroWASMTool({
    functionName: name,
    description: toolConfig?.description ?? `Zero tool: ${name}`,
    wasmBytes,
    parameters: toolConfig?.parameters,
    runtimeConfig: toolConfig?.runtimeConfig,
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────

/** Compute SHA-256 hash of source string (content-addressable key). */
async function hashSource(source: string): Promise<string> {
  const encoded = new TextEncoder().encode(source);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}