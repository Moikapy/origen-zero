/**
 * @moikapy/origen-zero — ZeroHTTPCompiler
 *
 * HTTP-based Zero compiler client that works in Cloudflare Workers
 * (and any environment with fetch). Calls a Zero compiler service
 * instead of spawning a subprocess.
 *
 * The Zero compiler service must implement these endpoints:
 *   POST /check   { source, path? } → ZeroCheckResult
 *   POST /graph   { source, path? } → ZeroGraphResult
 *   POST /size    { source, path? } → ZeroSizeResult
 *   POST /fix     { source, path? } → ZeroFixResult
 *   POST /build   { source, path?, options? } → ZeroBuildResult
 *   GET  /explain/:code → string
 */

import type {
  ZeroHTTPCompilerConfig,
  ZeroCompilerLike,
  ZeroSourceFile,
  ZeroCheckResult,
  ZeroGraphResult,
  ZeroSizeResult,
  ZeroFixResult,
  ZeroBuildResult,
  ZeroBuildOptions,
  ZeroDiagnostic,
} from "./types.js";
import {
  parseCheckOutput,
  parseGraphOutput,
  parseSizeOutput,
  parseFixOutput,
} from "./parser.js";
import { ZeroHTTPError, ZeroTimeoutError } from "./errors.js";

// ── Defaults ────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT = 30_000;

// ── ZeroHTTPCompiler ─────────────────────────────────────────────────────

export class ZeroHTTPCompiler implements ZeroCompilerLike {
  private readonly endpoint: string;
  private readonly apiKey: string | undefined;
  private readonly headers: Record<string, string>;
  private readonly timeout: number;
  private readonly fetchFn: typeof globalThis.fetch;

  constructor(config: ZeroHTTPCompilerConfig) {
    // Strip trailing slash
    this.endpoint = config.endpoint.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.headers = config.headers ?? {};
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
    this.fetchFn = config.fetch ?? globalThis.fetch;
  }

  // ── Public API ──────────────────────────────────────────────────────

  async check(source: string | ZeroSourceFile): Promise<ZeroCheckResult> {
    const raw = await this.post("/check", source);
    return parseCheckOutput(raw);
  }

  async graph(source: string | ZeroSourceFile): Promise<ZeroGraphResult> {
    const raw = await this.post("/graph", source);
    return parseGraphOutput(raw);
  }

  async size(source: string | ZeroSourceFile): Promise<ZeroSizeResult> {
    const raw = await this.post("/size", source);
    return parseSizeOutput(raw);
  }

  async fix(source: string | ZeroSourceFile): Promise<ZeroFixResult> {
    const raw = await this.post("/fix", source);
    return parseFixOutput(raw);
  }

  async build(
    source: string | ZeroSourceFile,
    options?: ZeroBuildOptions,
  ): Promise<ZeroBuildResult> {
    const body = this.sourceToBody(source);
    if (options) body.options = options;
    const json = await this.postJson("/build", body) as {
      ok?: boolean;
      output?: string;
      outputPath?: string;
      diagnostics?: ZeroDiagnostic[];
    };
    return {
      ok: json.ok ?? false,
      outputPath: json.output ?? json.outputPath,
      diagnostics: json.diagnostics ?? [],
    };
  }

  async explain(diagnosticCode: string): Promise<string> {
    const url = `${this.endpoint}/explain/${encodeURIComponent(diagnosticCode)}`;
    const res = await this.fetchWithTimeout(url, { method: "GET" });
    if (!res.ok) {
      throw new ZeroHTTPError(res.status, url, await res.text());
    }
    return (await res.text()).trim();
  }

  // ── Internal ────────────────────────────────────────────────────────

  private sourceToBody(
    source: string | ZeroSourceFile,
  ): Record<string, unknown> {
    if (typeof source === "string") {
      return { source };
    }
    return { source: source.content, path: source.path };
  }

  private async post(
    path: string,
    source: string | ZeroSourceFile,
  ): Promise<string> {
    const body = this.sourceToBody(source);
    return this.postRaw(path, body);
  }

  private async postJson(
    path: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const raw = await this.postRaw(path, body);
    return JSON.parse(raw);
  }

  private async postRaw(
    path: string,
    body: Record<string, unknown>,
  ): Promise<string> {
    const url = `${this.endpoint}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.headers,
    };
    if (this.apiKey) {
      headers["Authorization"] = this.apiKey;
    }

    const res = await this.fetchWithTimeout(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new ZeroHTTPError(res.status, url, await res.text());
    }

    return await res.text();
  }

  /** fetch with timeout. */
  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const res = await this.fetchFn(url, { ...init, signal: controller.signal });
      return res;
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        throw new ZeroTimeoutError(`HTTP ${init.method} ${url}`, this.timeout);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}