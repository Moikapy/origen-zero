/**
 * @moikapy/origen-zero — Zero CLI output parser
 *
 * Parses JSON output from `zero check --json`, `zero graph --json`,
 * `zero size --json`, and `zero fix --plan --json` into typed structures.
 */

import { z } from "zod";
import type {
  ZeroDiagnostic,
  ZeroCheckResult,
  ZeroGraphResult,
  ZeroSizeResult,
  ZeroFixResult,
  ZeroFixSuggestion,
} from "./types.js";

// ── Zod Schemas ─────────────────────────────────────────────────────────

/** Diagnostic code pattern: three uppercase letters + three digits. */
const DIAGNOSTIC_CODE_PATTERN = /^[A-Z]{3}\d{3}$/;

export const ZeroDiagnosticSchema = z.object({
  code: z.string().regex(DIAGNOSTIC_CODE_PATTERN, {
    message: "Diagnostic code must match XXX### pattern (e.g., NAM003)",
  }),
  severity: z.enum(["error", "warning", "info"]),
  message: z.string(),
  line: z.number().int().positive(),
  column: z.number().int().positive().optional(),
  repair: z
    .object({
      id: z.string(),
      suggestion: z.string().optional(),
    })
    .optional(),
});

export const ZeroCheckResultSchema = z.object({
  ok: z.boolean(),
  diagnostics: z.array(ZeroDiagnosticSchema),
  raw: z.record(z.string(), z.unknown()),
});

export const ZeroGraphResultSchema = z.object({
  ok: z.boolean(),
  graph: z.record(z.string(), z.array(z.string())),
  raw: z.record(z.string(), z.unknown()),
});

export const ZeroSizeResultSchema = z.object({
  ok: z.boolean(),
  sizes: z.record(z.string(), z.number()),
  raw: z.record(z.string(), z.unknown()),
});

export const ZeroFixSuggestionSchema = z.object({
  code: z.string(),
  line: z.number().int().positive(),
  message: z.string(),
  suggestion: z.string().optional(),
});

export const ZeroFixResultSchema = z.object({
  ok: z.boolean(),
  fixes: z.array(ZeroFixSuggestionSchema),
  raw: z.record(z.string(), z.unknown()),
});

// ── Parsers ──────────────────────────────────────────────────────────────

/** Parse a single diagnostic from raw JSON. */
export function parseDiagnostic(d: Record<string, unknown>): ZeroDiagnostic {
  return {
    code: String(d.code ?? "UNK000"),
    severity: (["error", "warning", "info"].includes(d.severity as string)
      ? d.severity
      : "error") as ZeroDiagnostic["severity"],
    message: String(d.message ?? ""),
    line: Number(d.line ?? 0) || 0,
    column: d.column ? Number(d.column) : undefined,
    repair: d.repair
      ? {
          id: String((d.repair as Record<string, unknown>).id ?? ""),
          suggestion: (d.repair as Record<string, unknown>).suggestion
            ? String((d.repair as Record<string, unknown>).suggestion)
            : undefined,
        }
      : undefined,
  };
}

/** Parse `zero check --json` output into a typed ZeroCheckResult. */
export function parseCheckOutput(raw: string): ZeroCheckResult {
  const json = JSON.parse(raw);
  return {
    ok: json.ok ?? false,
    diagnostics: (json.diagnostics ?? []).map(parseDiagnostic),
    raw: json,
  };
}

/** Parse `zero graph --json` output into a typed ZeroGraphResult. */
export function parseGraphOutput(raw: string): ZeroGraphResult {
  const json = JSON.parse(raw);
  return {
    ok: json.ok ?? false,
    graph: json.graph ?? {},
    raw: json,
  };
}

/** Parse `zero size --json` output into a typed ZeroSizeResult. */
export function parseSizeOutput(raw: string): ZeroSizeResult {
  const json = JSON.parse(raw);
  return {
    ok: json.ok ?? false,
    sizes: json.sizes ?? {},
    raw: json,
  };
}

/** Parse `zero fix --plan --json` output into a typed ZeroFixResult. */
export function parseFixOutput(raw: string): ZeroFixResult {
  const json = JSON.parse(raw);
  const fixes: ZeroFixSuggestion[] = (json.fixes ?? []).map(
    (f: Record<string, unknown>) => ({
      code: String(f.code ?? ""),
      line: Number(f.line ?? 0) || 0,
      message: String(f.message ?? ""),
      suggestion: f.suggestion ? String(f.suggestion) : undefined,
    }),
  );
  return {
    ok: json.ok ?? false,
    fixes,
    raw: json,
  };
}