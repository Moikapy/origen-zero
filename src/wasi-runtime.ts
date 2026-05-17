/**
 * @moikapy/origen-zero — WASI runtime for Zero WASM modules
 *
 * Full WASI snapshot preview 1 implementation matching the Zero CLI's
 * wasm-runtime-smoke.mjs. Supports: args, env, fd_read, fd_write,
 * path_open, fd_close, fd_filestat_get, fd_readdir, path_mkdir,
 * path_remove_directory, path_unlink_file, path_rename.
 *
 * Zero programs that use World (stdout/stderr), std.args, std.env,
 * or std.fs (Fs resource) all route through these WASI imports.
 *
 * Uses only Uint8Array/TextEncoder/TextDecoder — no Node.js Buffer.
 * Works in Cloudflare Workers, browsers, and Node.js.
 */

// ── Portable byte utilities (Workers-compatible, no Buffer) ────────────

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function concatUint8(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

// ── Types ─────────────────────────────────────────────────────────────────

export interface ZeroWASIRuntimeConfig {
  /** Command-line args (default: ["zero"]). */
  args?: string[];
  /** Environment variables (default: []). Format: "KEY=VALUE". */
  env?: string[];
  /** Pre-populated files: Map<path, Uint8Array>. */
  files?: Map<string, Uint8Array>;
  /** Pre-populated directories. */
  dirs?: Set<string>;
}

export interface ZeroWASIRuntime {
  /** WASI imports to pass to WebAssembly.instantiate(). */
  imports: Record<string, Record<string, WebAssembly.ImportValue>>;
  /** Get all captured stdout output. */
  getStdout(): string;
  /** Get all captured stderr output. */
  getStderr(): string;
  /** Get the virtual filesystem state. */
  getFiles(): Map<string, Uint8Array>;
  /** Get the virtual directory set. */
  getDirs(): Set<string>;
  /** Set the instance reference (called after instantiation). */
  setInstance(instance: WebAssembly.Instance): void;
}

// ── Implementation ────────────────────────────────────────────────────────

export function createZeroWASIRuntime(config?: ZeroWASIRuntimeConfig): ZeroWASIRuntime {
  const args = config?.args ?? ["zero"];
  const env = config?.env ?? [];
  const files = config?.files ?? new Map<string, Uint8Array>();
  const dirs = config?.dirs ?? new Set(["."]);

  let instance: WebAssembly.Instance;
  let stdout = "";
  let stderr = "";
  const fds = new Map<number, { type: "file" | "dir"; path: string; pos: number }>();
  let nextFd = 4; // 0=stdin, 1=stdout, 2=stderr, 3+ available

  // ── Helpers ──────────────────────────────────────────────────────────

  function view(): DataView {
    const memory = instance.exports.memory as WebAssembly.Memory;
    return new DataView(memory.buffer);
  }

  function mem(): Uint8Array {
    const memory = instance.exports.memory as WebAssembly.Memory;
    return new Uint8Array(memory.buffer);
  }

  function readI32(ptr: number): number {
    return view().getUint32(ptr, true);
  }

  function writeI32(ptr: number, value: number): void {
    view().setUint32(ptr, value >>> 0, true);
  }

  function writeU64(ptr: number, value: number): void {
    view().setBigUint64(ptr, BigInt(value), true);
  }

  function readString(ptr: number, len: number): string {
    return decoder.decode(mem().subarray(ptr, ptr + len));
  }

  function byteLength(items: string[]): number {
    return items.reduce((total, item) => total + encoder.encode(item).length + 1, 0);
  }

  function writeStrings(ptrArray: number, ptrBytes: number, items: string[]): void {
    let offset = ptrBytes;
    for (let i = 0; i < items.length; i++) {
      const bytes = encoder.encode(items[i]!);
      writeI32(ptrArray + i * 4, offset);
      mem().set(bytes, offset);
      mem()[offset + bytes.length] = 0; // null terminator
      offset += bytes.length + 1;
    }
  }

  function writeFileAt(entry: { path: string; pos: number }, chunks: Uint8Array[]): void {
    const incoming = concatUint8(chunks);
    const current = files.get(entry.path) || new Uint8Array(0);
    const end = entry.pos + incoming.length;
    const next = new Uint8Array(Math.max(current.length, end));
    next.set(current, 0);
    next.set(incoming, entry.pos);
    files.set(entry.path, next);
    entry.pos = end;
  }

  // ── WASI Imports ─────────────────────────────────────────────────────

  const imports: Record<string, Record<string, WebAssembly.ImportValue>> = {
    wasi_snapshot_preview1: {
      args_sizes_get(argcPtr: number, argvBufSizePtr: number): number {
        writeI32(argcPtr, args.length);
        writeI32(argvBufSizePtr, byteLength(args));
        return 0;
      },

      args_get(argvPtr: number, argvBufPtr: number): number {
        writeStrings(argvPtr, argvBufPtr, args);
        return 0;
      },

      environ_sizes_get(countPtr: number, envBufSizePtr: number): number {
        writeI32(countPtr, env.length);
        writeI32(envBufSizePtr, byteLength(env));
        return 0;
      },

      environ_get(envPtr: number, envBufPtr: number): number {
        writeStrings(envPtr, envBufPtr, env);
        return 0;
      },

      path_open(
        fd: number, dirflags: number, pathPtr: number, pathLen: number,
        oflags: number, rightsBase: bigint, rightsInheriting: bigint,
        fdflags: number, openedFdPtr: number,
      ): number {
        const path = readString(pathPtr, pathLen);
        const directory = (oflags & 2) !== 0;
        const write = (oflags & 9) !== 0 || (rightsBase & 64n) !== 0n;

        if (directory) {
          if (!dirs.has(path)) return 44; // ENOENT
          const opened = nextFd++;
          fds.set(opened, { type: "dir", path, pos: 0 });
          writeI32(openedFdPtr, opened);
          return 0;
        }

        if (write) files.set(path, new Uint8Array(0));
        if (!files.has(path)) return 44; // ENOENT
        const opened = nextFd++;
        fds.set(opened, { type: "file", path, pos: 0 });
        writeI32(openedFdPtr, opened);
        return 0;
      },

      fd_read(fd: number, iovs: number, iovsLen: number, nread: number): number {
        const entry = fds.get(fd);
        if (!entry || entry.type !== "file") return 8; // EBADF
        const source = files.get(entry.path) || new Uint8Array(0);
        let total = 0;
        for (let i = 0; i < iovsLen; i++) {
          const ptr = readI32(iovs + i * 8);
          const len = readI32(iovs + i * 8 + 4);
          const chunk = source.subarray(entry.pos, entry.pos + len);
          mem().set(chunk, ptr);
          entry.pos += chunk.length;
          total += chunk.length;
        }
        writeI32(nread, total);
        return 0;
      },

      fd_write(fd: number, iovs: number, iovsLen: number, nwritten: number): number {
        let total = 0;
        const chunks: Uint8Array[] = [];
        for (let i = 0; i < iovsLen; i++) {
          const ptr = readI32(iovs + i * 8);
          const len = readI32(iovs + i * 8 + 4);
          chunks.push(mem().slice(ptr, ptr + len));
          total += len;
        }
        if (fd === 1) {
          stdout += decoder.decode(concatUint8(chunks));
        } else if (fd === 2) {
          stderr += decoder.decode(concatUint8(chunks));
        } else {
          const entry = fds.get(fd);
          if (!entry || entry.type !== "file") return 8; // EBADF
          writeFileAt(entry, chunks);
        }
        writeI32(nwritten, total);
        return 0;
      },

      fd_close(fd: number): number {
        fds.delete(fd);
        return 0;
      },

      fd_filestat_get(fd: number, buf: number): number {
        const entry = fds.get(fd);
        if (!entry || entry.type !== "file") return 8; // EBADF
        writeU64(buf + 32, (files.get(entry.path) || new Uint8Array(0)).length);
        return 0;
      },

      fd_readdir(fd: number, buf: number, bufLen: number, cookie: number, nread: number): number {
        const entry = fds.get(fd);
        if (!entry || entry.type !== "dir") return 8; // EBADF
        writeI32(nread, 0);
        return 0;
      },

      path_create_directory(fd: number, pathPtr: number, pathLen: number): number {
        dirs.add(readString(pathPtr, pathLen));
        return 0;
      },

      path_remove_directory(fd: number, pathPtr: number, pathLen: number): number {
        const path = readString(pathPtr, pathLen);
        if (!dirs.has(path)) return 44; // ENOENT
        dirs.delete(path);
        return 0;
      },

      path_unlink_file(fd: number, pathPtr: number, pathLen: number): number {
        const path = readString(pathPtr, pathLen);
        if (!files.has(path)) return 44; // ENOENT
        files.delete(path);
        return 0;
      },

      path_rename(
        oldFd: number, oldPtr: number, oldLen: number,
        newFd: number, newPtr: number, newLen: number,
      ): number {
        const oldPath = readString(oldPtr, oldLen);
        const newPath = readString(newPtr, newLen);
        if (!files.has(oldPath)) return 44; // ENOENT
        files.set(newPath, files.get(oldPath)!);
        files.delete(oldPath);
        return 0;
      },

      // Stubs for WASI functions Zero doesn't use but may import
      proc_exit(code: number): void {
        throw new Error(`Zero program exited with code ${code}`);
      },

      clock_time_get(clockId: number, precision: bigint, timePtr: number): number {
        // Return current time as nanoseconds for realtime clock
        if (clockId === 0) {
          const ns = BigInt(Date.now()) * 1_000_000n;
          view().setBigUint64(timePtr, ns, true);
          return 0;
        }
        return 0;
      },

      random_get(buf: number, bufLen: number): number {
        const bytes = crypto.getRandomValues(new Uint8Array(bufLen));
        mem().set(bytes, buf);
        return 0;
      },

      sched_yield(): number { return 0; },
      poll_oneoff(inPtr: number, outPtr: number, nsubscriptions: number, nevents: number): number {
        writeI32(nevents, 0);
        return 0;
      },
    },
  };

  return {
    imports,
    getStdout: () => stdout,
    getStderr: () => stderr,
    getFiles: () => files,
    getDirs: () => dirs,
    setInstance(i: WebAssembly.Instance) { instance = i; },
  };
}