import { describe, it, expect } from "vitest";
import {
  ZeroError,
  ZeroCompilerNotFoundError,
  ZeroCheckFailedError,
  ZeroBuildFailedError,
  ZeroTimeoutError,
  ZeroExecutionError,
} from "../src/errors.js";

describe("ZeroError", () => {
  it("has correct name and properties", () => {
    const err = new ZeroError("test error", "TEST_CODE");
    expect(err.name).toBe("ZeroError");
    expect(err.message).toBe("test error");
    expect(err.code).toBe("TEST_CODE");
    expect(err.diagnostics).toBeUndefined();
  });

  it("carries diagnostics", () => {
    const diags = [
      { code: "TYP001", severity: "error" as const, message: "bad", line: 1 },
    ];
    const err = new ZeroError("with diags", "CODE", diags);
    expect(err.diagnostics).toHaveLength(1);
    expect(err.diagnostics![0]!.code).toBe("TYP001");
  });

  it("is instance of Error", () => {
    const err = new ZeroError("test", "CODE");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ZeroError);
  });
});

describe("ZeroCompilerNotFoundError", () => {
  it("includes binary path in message", () => {
    const err = new ZeroCompilerNotFoundError("/usr/local/bin/zero");
    expect(err.name).toBe("ZeroCompilerNotFoundError");
    expect(err.message).toContain("/usr/local/bin/zero");
    expect(err.code).toBe("ZERO_NOT_FOUND");
    expect(err).toBeInstanceOf(ZeroError);
  });
});

describe("ZeroCheckFailedError", () => {
  it("formats diagnostics in message", () => {
    const diags = [
      { code: "TYP001", severity: "error" as const, message: "Type mismatch", line: 5 },
      { code: "NAM003", severity: "warning" as const, message: "Unused var", line: 10 },
    ];
    const err = new ZeroCheckFailedError(diags);
    expect(err.name).toBe("ZeroCheckFailedError");
    expect(err.message).toContain("2 diagnostic(s)");
    expect(err.message).toContain("TYP001");
    expect(err.message).toContain("NAM003");
    expect(err.diagnostics).toHaveLength(2);
    expect(err).toBeInstanceOf(ZeroError);
  });
});

describe("ZeroBuildFailedError", () => {
  it("uses correct code", () => {
    const err = new ZeroBuildFailedError([]);
    expect(err.name).toBe("ZeroBuildFailedError");
    expect(err.code).toBe("ZERO_BUILD_FAILED");
    expect(err).toBeInstanceOf(ZeroError);
  });
});

describe("ZeroTimeoutError", () => {
  it("includes command and timeout in message", () => {
    const err = new ZeroTimeoutError("zero check --json foo.0", 30000);
    expect(err.name).toBe("ZeroTimeoutError");
    expect(err.message).toContain("zero check --json foo.0");
    expect(err.message).toContain("30000ms");
    expect(err.code).toBe("ZERO_TIMEOUT");
  });
});

describe("ZeroExecutionError", () => {
  it("includes exit code and stderr", () => {
    const err = new ZeroExecutionError(1, "segmentation fault");
    expect(err.name).toBe("ZeroExecutionError");
    expect(err.exitCode).toBe(1);
    expect(err.stderr).toBe("segmentation fault");
    expect(err.message).toContain("code 1");
    expect(err.code).toBe("ZERO_EXECUTION_ERROR");
  });
});