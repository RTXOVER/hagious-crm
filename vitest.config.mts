import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    // Testes de banco criam e removem usuários; rodam em sequência
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
