import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import ts from "typescript-eslint";
export default defineConfig([
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  // video/: video demo, proyecto aparte (Remotion) con sus propias dependencias.
  globalIgnores([".next/**", "next-env.d.ts", "video/**"]),
]);
