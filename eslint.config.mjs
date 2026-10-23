import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/generated/**',
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/.turbo/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      // Allows leaving fields out of an object: const { secret, ...rest } = value;
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
    },
  },
  {
    // Plain Node scripts (no TypeScript): they run in Node, so its globals exist.
    files: ['**/scripts/**/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly', URL: 'readonly' } },
  },
  {
    // NestJS injects by constructor parameter type, so those imports must stay value imports.
    // With project info the type-imports rule understands emitDecoratorMetadata and leaves them alone.
    files: ['apps/api/**/*.ts'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    // The system connection sees every tenant; only provisioning, auth and infrastructure may use it.
    files: ['apps/api/src/**/*.ts'],
    ignores: [
      'apps/api/src/infrastructure/**',
      'apps/api/src/modules/tenants/**',
      'apps/api/src/modules/auth/**',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/system-prisma.service*'],
              message:
                'SystemPrismaService bypasses tenant isolation. Use TenantDb (docs/adr/0001-multi-tenancy-rls.md).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    // Colors live in styles/tokens.css only; components use token utilities (bg-primary, ...).
    files: ['apps/web/src/**/*.{ts,tsx}'],
    ignores: ['apps/web/src/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/#[0-9a-fA-F]{3,8}\\b/]',
          message:
            'Hard-coded hex colors are not allowed. Use a design token from styles/tokens.css.',
        },
        {
          selector:
            'Literal[value=/\\b(bg|text|border|ring|fill|stroke|from|via|to|outline|divide|shadow)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white)(-\\d{2,3})?\\b/]',
          message:
            'Tailwind palette colors are not allowed. Use a semantic token (bg-primary, text-muted-foreground, ...).',
        },
        {
          selector: 'Literal[value=/-\\[(#|rgb|hsl|oklch)/]',
          message: 'Arbitrary color values are not allowed. Use a design token.',
        },
      ],
    },
  },
);
