# Third-party notices

FlowMotion uses the following third-party software. draw.io is an optional add-on: its files are not part of the plugin download, and users fetch them from the draw.io release on GitHub. Monaco is built into `main.js`.

| Component              | Used for                                   | License            |
| ---------------------- | ------------------------------------------ | ------------------ |
| draw.io (diagrams.net) | Optional draw.io editor (downloaded into `drawio/`) | Apache License 2.0 |
| Monaco Editor          | Code editor (built into `main.js`)         | MIT                |

The plugin's bundled dependencies are `yaml` (ISC), `elkjs` (Eclipse Public License 2.0) and `monaco-editor` (MIT). See `package.json` for the full list.

Obsidian's own API and CodeMirror packages are provided by Obsidian at runtime and are not bundled.
