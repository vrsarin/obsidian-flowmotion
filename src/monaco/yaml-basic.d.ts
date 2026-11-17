declare module 'monaco-editor/languages/definitions/yaml/yaml' {
  import type { languages } from 'monaco-editor';
  export const conf: languages.LanguageConfiguration;
  export const language: languages.IMonarchLanguage;
}

declare module 'monaco-editor/editor/editor.main' {
  export * from 'monaco-editor/editor/editor.api';
}
