# Third-party notices

FlowMotion uses the following third-party software. draw.io is downloaded from the draw.io release on GitHub. Monaco is an optional add-on downloaded as a pinned npm package from the Monaco Editor project.

| Component              | Used for                                                  | License            |
| ---------------------- | --------------------------------------------------------- | ------------------ |
| draw.io (diagrams.net) | Optional draw.io editor (downloaded into `drawio/`)       | Apache License 2.0 |
| Monaco Editor          | Optional Rich Code Editor (downloaded into `monaco/`)     | MIT                |
| CodeMirror commands    | Undo, redo and editor key bindings (bundled in `main.js`) | MIT                |

The plugin bundles `yaml` (ISC), `elkjs` (Eclipse Public License 2.0), and MIT-licensed CodeMirror commands and YAML syntax support. The release includes Monaco's CSS in `styles.css`, but not its JavaScript runtime. See `package.json` for the full dependency list.

Obsidian's API, `@codemirror/state`, and `@codemirror/view` are provided by Obsidian at runtime and are not bundled.
