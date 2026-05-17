/**
 * @moikapy/origen-zero — ZeroCompiler class
 *
 * Wraps the Zero CLI binary, invoking it as a subprocess with --json flags
 * and parsing the structured output into typed results.
 */

import { execFile } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type {
  ZeroCompilerLike,
  ZeroCompilerConfig,
  ZeroSourceFile,
  ZeroCheckResult,
  ZeroGraphResult,
  ZeroSizeResult,
  ZeroFixResult,
  ZeroBuildResult,
  ZeroBuildOptions,
} from "./types.js";
import {
  parseCheckOutput,
  parseGraphOutput,
  parseSizeOutput,
  parseFixOutput,
} from "./parser.js";
import {
  ZeroCompilerNotFoundError,
  ZeroTimeoutError,
  ZeroBuildFailedError,
} from "./errors.js";

// ── Defaults ────────────────────────────────────────────────────────────

const DEFAULT_BINARY = "zero";
const DEFAULT_TIMEOUT = 30_000;
const TEMP_DIR = ".zero-origen/tmp";
const ZERO_EXIT_OK = 0;
const ZERO_EXIT_ERRORS = 1;
const ZERO_EXIT_INTERNAL = 2;

// ── ZeroCompiler ────────────────────────────────────────────────────────

export class ZeroCompiler implements ZeroCompilerLike {
  private readonly binaryPath: string;
  private readonly workingDir: string;
  private readonly timeout: number;

  constructor(config?: ZeroCompilerConfig) {
    this.binaryPath = config?.binaryPath ?? DEFAULT_BINARY;
    this.workingDir = config?.workingDir ?? process.cwd();
    this.timeout = config?.timeout ?? DEFAULT_TIMEOUT;
  }

  // ── Public API ──────────────────────────────────────────────────────

  /** Check a Zero file or package for errors. Returns structured diagnostics. */
  async check(source: string | ZeroSourceFile): Promise<ZeroCheckResult> {
    const filePath = await this.writeSource(source);
    try {
      const stdout = await this.exec(["check", "--json", filePath]);
      return parseCheckOutput(stdout);
    } finally {
      await this.cleanup(filePath);
    }
  }

  /** Get the dependency graph for a Zero package. */
  async graph(source: string | ZeroSourceFile): Promise<ZeroGraphResult> {
    const filePath = await this.writeSource(source);
    try {
      const stdout = await this.exec(["graph", "--json", filePath]);
      return parseGraphOutput(stdout);
    } finally {
      await this.cleanup(filePath);
    }
  }

  /** Get size estimates for functions in a Zero file. */
  async size(source: string | ZeroSourceFile): Promise<ZeroSizeResult> {
    const filePath = await this.writeSource(source);
    try {
      const stdout = await this.exec(["size", "--json", filePath]);
      return parseSizeOutput(stdout);
    } finally {
      await this.cleanup(filePath);
    }
  }

  /** Get repair suggestions for a Zero program. */
  async fix(source: string | ZeroSourceFile): Promise<ZeroFixResult> {
    const filePath = await this.writeSource(source);
    try {
      const stdout = await this.exec(["fix", "--plan", "--json", filePath]);
      return parseFixOutput(stdout);
    } finally {
      await this.cleanup(filePath);
    }
  }

  /** Build a Zero file to a native executable. */
  async build(
    source: string | ZeroSourceFile,
    options?: ZeroBuildOptions,
  ): Promise<ZeroBuildResult> {
    const filePath = await this.writeSource(source);
    const args = ["build", "--json", "--emit", options?.emit ?? "exe"];

    if (options?.target) {
      args.push("--target", options.target);
    }

    if (options?.out) {
      args.push("--out", options.out);
    }

    args.push(filePath);

    try {
      const stdout = await this.exec(args);
      // Build produces structured JSON output
      const json = JSON.parse(stdout);
      return {
        ok: true,
        outputPath: json.artifactPath ?? options?.out,
        diagnostics: [],
      };
    } catch (err) {
      if (err instanceof ZeroCompilerNotFoundError) throw err;
      // Build errors may include diagnostics in stderr or structured output
      return {
        ok: false,
        diagnostics: [],
      };
    } finally {
      await this.cleanup(filePath);
    }
  }

  /** Get a human-readable explanation for a diagnostic code. */
  async explain(diagnosticCode: string): Promise<string> {
    const stdout = await this.exec(["explain", diagnosticCode]);
    return stdout.trim();
  }

  // ── Internal ────────────────────────────────────────────────────────

  /** Resolve source to a file path. If inline content, write to temp dir. */
  private async writeSource(source: string | ZeroSourceFile): Promise<string> {
    // If it's a ZeroSourceFile with explicit content, write to temp
    if (typeof source !== "string") {
      if (source.content !== undefined) {
        const tmpPath = join(this.workingDir, TEMP_DIR, source.path);
        await mkdir(join(this.workingDir, TEMP_DIR), { recursive: true });
        await writeFile(tmpPath, source.content, "utf-8");
        return tmpPath;
      }
      // Content is undefined — read from disk at source.path
      return source.path;
    }

    // String: check if it's a file path that exists on disk
    try {
      const stat = await import("node:fs/promises").then((fs) => fs.stat(source));
      if (stat.isFile()) return source; // It's a real file path
    } catch {
      // Not a file — treat as inline source
    }

    // Inline source — write to temp file
    const tmpPath = join(this.workingDir, TEMP_DIR, `check-${Date.now()}.0`);
    await mkdir(join(this.workingDir, TEMP_DIR), { recursive: true });
    await writeFile(tmpPath, source, "utf-8");
    return tmpPath;
  }

  /** Clean up temp files (best effort — ignore errors). */
  private async cleanup(filePath: string): Promise<void> {
    if (filePath.includes(TEMP_DIR)) {
      await rm(filePath, { force: true }).catch(() => {});
    }
  }

  /**
   * Execute the Zero CLI binary with the given arguments.
   * Returns stdout on success (exit code 0).
   * Throws ZeroCompilerNotFoundError if the binary isn't found.
   * Throws ZeroTimeoutError if the invocation exceeds the timeout.
   */
  private exec(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        killed = true;
        reject(new ZeroTimeoutError(`${this.binaryPath} ${args.join(" ")}`, this.timeout));
      }, this.timeout);

      let killed = false;

      execFile(
        this.binaryPath,
        args,
        {
          cwd: this.workingDir,
          maxBuffer: 1024 * 1024, // 1MB
        },
        (error, stdout, stderr) => {
          clearTimeout(timeout);
          if (killed) return;

          if (error) {
            // ENOENT means binary not found
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
              reject(new ZeroCompilerNotFoundError(this.binaryPath));
              return;
            }
            // Exit code 1 means errors in the source – check both code (Node 25+) and status (older)
            const exitCode = (error as NodeJS.ErrnoException & { code?: number; status?: number }).code
              ?? (error as NodeJS.ErrnoException & { status?: number }).status;
            if (exitCode === ZERO_EXIT_ERRORS && stdout) {
              resolve(stdout);
              return;
            }
            // Exit code 2 means internal error
            if (exitCode === ZERO_EXIT_INTERNAL) {
              reject(
                new ZeroBuildFailedError([
                  {
                    code: "ZERO_INTERNAL",
                    severity: "error",
                    message: stderr || error.message,
                    line: 0,
                  },
                ]),
              );
              return;
            }
            reject(error);
            return;
          }

          resolve(stdout);
        },
      );
    });
  }
}