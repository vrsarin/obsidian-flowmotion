/** Convert our `${name}` / `${}` template syntax to Monaco snippet syntax (`${1:name}` / `$1`). */
export function toMonacoSnippet(template: string): string {
  let n = 0;
  return template.replace(/\$\{([^}]*)\}/g, (_m, name: string) => { n++; return name ? `\${${n}:${name}}` : `$${n}`; });
}
