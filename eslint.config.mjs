import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', '**/.turbo/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
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
