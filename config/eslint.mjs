import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    "dist/**",
    ".vinext/**",
    ".wrangler/**",
    ".sites-runtime/**",
    "outputs/**",
    "work/**",
  ]),

  {
    files: ["**/*.cjs"],
    rules: {"@typescript-eslint/no-require-imports": "off"},
  },
  {
    // This script is served by the Python application, without a Next router.
    files: ["selfhosted/static/*.js"],
    rules: {"@next/next/no-location-assign-relative-destination": "off"},
  },
]);

export default eslintConfig;
