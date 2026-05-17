import { describe, it, expect } from "vitest";
import {
  parseDiagnostic,
  parseCheckOutput,
  parseGraphOutput,
  parseSizeOutput,
  parseFixOutput,
} from "../src/parser.js";

describe("parseDiagnostic", () => {
  it("parses a complete diagnostic", () => {
    const raw = {
      code: "TYP001",
      severity: "error",
      message: "Type mismatch",
      line: 5,
      column: 12,
      repair: { id: "insert-type-annotation", suggestion: "Add ': i32'" },
    };
    const d = parseDiagnostic(raw);
    expect(d.code).toBe("TYP001");
    expect(d.severity).toBe("error");
    expect(d.message).toBe("Type mismatch");
    expect(d.line).toBe(5);
    expect(d.column).toBe(12);
    expect(d.repair?.id).toBe("insert-type-annotation");
    expect(d.repair?.suggestion).toBe("Add ': i32'");
  });

  it("handles missing optional fields", () => {
    const raw = { code: "NAM003", message: "Undefined name" };
    const d = parseDiagnostic(raw);
    expect(d.code).toBe("NAM003");
    expect(d.severity).toBe("error"); // default
    expect(d.line).toBe(0);
    expect(d.column).toBeUndefined();
    expect(d.repair).toBeUndefined();
  });

  it("handles unknown severity gracefully", () => {
    const raw = { code: "UNK999", severity: "fatal", message: "Boom", line: 1 };
    const d = parseDiagnostic(raw);
    expect(d.severity).toBe("error"); // fallback
  });
});

describe("parseCheckOutput", () => {
  it("parses a passing check result", () => {
    const raw = JSON.stringify({
      ok: true,
      diagnostics: [],
    });
    const result = parseCheckOutput(raw);
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("parses a failing check result with diagnostics", () => {
    const raw = JSON.stringify({
      ok: false,
      diagnostics: [
        {
          code: "TYP001",
          severity: "error",
          message: "Type mismatch",
          line: 5,
          column: 12,
          repair: { id: "insert-type-annotation" },
        },
      ],
    });
    const result = parseCheckOutput(raw);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.code).toBe("TYP001");
  });
});

describe("parseGraphOutput", () => {
  it("parses a dependency graph", () => {
    const raw = JSON.stringify({
      ok: true,
      graph: {
        main: ["out"],
        add: [],
        multiply: [],
      },
    });
    const result = parseGraphOutput(raw);
    expect(result.ok).toBe(true);
    expect(result.graph.main).toEqual(["out"]);
    expect(result.graph.add).toEqual([]);
  });
});

describe("parseSizeOutput", () => {
  it("parses size estimates", () => {
    const raw = JSON.stringify({
      ok: true,
      sizes: {
        main: 512,
        add: 128,
        multiply: 256,
        total: 896,
      },
    });
    const result = parseSizeOutput(raw);
    expect(result.ok).toBe(true);
    expect(result.sizes.main).toBe(512);
    expect(result.sizes.total).toBe(896);
  });
});

describe("parseFixOutput", () => {
  it("parses fix suggestions", () => {
    const raw = JSON.stringify({
      ok: true,
      fixes: [
        {
          code: "TYP001",
          line: 5,
          message: "Add type annotation",
          suggestion: "Change `x` to `x: i32`",
        },
      ],
    });
    const result = parseFixOutput(raw);
    expect(result.ok).toBe(true);
    expect(result.fixes).toHaveLength(1);
    expect(result.fixes[0]!.code).toBe("TYP001");
    expect(result.fixes[0]!.suggestion).toBe("Change `x` to `x: i32`");
  });
});