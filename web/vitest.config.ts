import { defineConfig } from "vitest/config";
import path from "node:path";

// No plugins on purpose. @vitejs/plugin-react drags in its own major of vite, which then disagrees
// with the one vitest carries and turns every config edit into a type argument. esbuild's automatic
// JSX runtime covers what the tests need (rendering components), and the one alias the project uses
// is three lines here.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
  },
});
