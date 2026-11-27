import eslintReact from "@eslint-react/eslint-plugin";
import js from "@eslint/js";
import vitest from "@vitest/eslint-plugin";
import prettier from "eslint-config-prettier";
import { importX } from "eslint-plugin-import-x";
import jsxA11y from "eslint-plugin-jsx-a11y-x";
import nodePlugin from "eslint-plugin-n";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";

const FRONTEND = "web/frontend/**/*.{js,jsx}";
const BACKEND = "web/**/*.js";
const TESTS = ["**/*.test.{js,jsx}", "web/test/**", "web/frontend/test/**"];

export default defineConfig([
  globalIgnores([
    "**/node_modules/**",
    "**/dist/**",
    "**/coverage/**",
    ".shopify/**",
    "extensions/*/build/**",
  ]),

  // Baseline for all JavaScript.
  {
    files: ["**/*.{js,jsx}"],
    extends: [js.configs.recommended, importX.flatConfigs.recommended],
    languageOptions: { ecmaVersion: "latest", sourceType: "module" },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    settings: {
      "import-x/resolver": { node: { extensions: [".js", ".jsx", ".json"] } },
    },
    rules: {
      // Correctness
      "array-callback-return": "error",
      "no-await-in-loop": "warn",
      "no-constant-binary-expression": "error",
      "no-promise-executor-return": "error",
      "no-self-compare": "error",
      "no-template-curly-in-string": "error",
      "no-unmodified-loop-condition": "error",
      "no-unreachable-loop": "error",
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
      "require-atomic-updates": "off",

      // Safety
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-script-url": "error",

      // Style and clarity (formatting itself is left to Prettier)
      curly: ["error", "multi-line"],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-console": "warn",
      "no-else-return": ["error", { allowElseIf: false }],
      "no-lonely-if": "error",
      "no-nested-ternary": "off",
      "no-param-reassign": ["error", { props: false }],
      "no-return-await": "off",
      "no-throw-literal": "error",
      "no-useless-concat": "error",
      "no-useless-rename": "error",
      "no-useless-return": "error",
      "no-var": "error",
      "object-shorthand": ["error", "always"],
      "prefer-const": "error",
      "prefer-object-spread": "error",
      "prefer-template": "error",

      // Imports
      "import-x/first": "error",
      "import-x/newline-after-import": "error",
      "import-x/no-duplicates": "error",
      "import-x/no-mutable-exports": "error",
      "import-x/no-self-import": "error",
      "import-x/no-useless-path-segments": "error",
      // i18next and similar libraries are meant to be used via their default export.
      "import-x/no-named-as-default-member": "off",
      // Vite's virtual module for React Fast Refresh.
      "import-x/no-unresolved": ["error", { ignore: ["^/@react-refresh$"] }],
      "import-x/order": [
        "error",
        {
          groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],
    },
  },

  // Backend: Node.js (ESM)
  {
    files: [BACKEND],
    ignores: [FRONTEND],
    extends: [nodePlugin.configs["flat/recommended-module"]],
    languageOptions: { globals: globals.node },
    rules: {
      "n/no-process-exit": "off", // used deliberately for fail-fast startup
      "n/no-unpublished-import": "off", // dev-only imports in tests and config
      "n/prefer-node-protocol": "error",
      "n/no-missing-import": "off", // covered by import-x/no-unresolved
    },
  },

  // Frontend: React in the browser
  {
    files: [FRONTEND],
    extends: [
      eslintReact.configs.recommended,
      // react-hooks (below) owns the hook rules; avoid duplicate reports.
      eslintReact.configs["disable-conflict-eslint-plugin-react-hooks"],
      reactHooks.configs.flat["recommended-latest"],
      jsxA11y.configs.recommended,
    ],
    languageOptions: {
      globals: { ...globals.browser, shopify: "readonly" },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // Polaris is loaded as web components from Shopify's CDN; keep the
      // deprecated Polaris React package out of the app.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@shopify/polaris", message: "Use Polaris web components (s-*) instead." },
            {
              name: "@shopify/polaris-icons",
              message: "Use the `icon` property on s-* components.",
            },
          ],
        },
      ],
      "@eslint-react/no-array-index-key": "error",
      "@eslint-react/no-missing-key": "error",
    },
  },

  // Vite injects these at build time.
  {
    files: ["web/frontend/vite.config.js", "web/frontend/vitest.config.js"],
    languageOptions: { globals: globals.node },
  },

  // Tests
  {
    files: TESTS,
    extends: [vitest.configs.recommended],
    rules: {
      "no-console": "off",
      "vitest/consistent-test-it": ["error", { fn: "it" }],
      "vitest/no-focused-tests": "error",
      "vitest/no-disabled-tests": "warn",
      "vitest/expect-expect": [
        "error",
        { assertFunctionNames: ["expect", "fieldErrors", "scheduleError"] },
      ],
    },
  },

  // Must be last: turns off rules that conflict with Prettier formatting.
  prettier,
]);
