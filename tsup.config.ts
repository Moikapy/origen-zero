import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    tools: "src/tools.ts",
    compiler: "src/compiler.ts",
    "http-compiler": "src/http-compiler.ts",
    "wasm-tool": "src/wasm-tool.ts",
  },
  format: ["esm"],
  target: "es2022",
  dts: true,
  clean: true,
  sourcemap: true,
  external: ["@moikapy/origen"],
});