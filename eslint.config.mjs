// Lint rules from eslint-plugin-obsidianmd, the same checks Obsidian's community plugin review uses.
import obsidianmd from 'eslint-plugin-obsidianmd';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['dist/**', 'out/**', 'node_modules/**', 'examples/**', '.cache/**', 'scripts/**', 'test/**', 'eslint.config.mjs'] },
  ...obsidianmd.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: { parserOptions: { project: './tsconfig.json', tsconfigRootDir: import.meta.dirname } },
  },
  {
    // The local draw.io server is desktop only (started only when Platform.isDesktopApp) and needs Node's http, fs and path.
    files: ['src/obsidian/drawio-server.ts'],
    rules: { 'obsidianmd/no-nodejs-modules': 'off' },
  },
];
