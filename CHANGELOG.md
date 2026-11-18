# Changelog

## [Unreleased]

- CodeMirror is the default editor for `.flow` files, with a live preview. Monaco is a separate optional Rich Code Editor download.
- The optional Monaco add-on is downloaded from its pinned npm package, not from a FlowMotion GitHub release.
- Fixed the transparent Monaco context menu in the diagram editor.

## [1.0.0]

- Monaco 0.57 is built into `main.js`; the Code editor setting is a plain toggle and downloads nothing.
- The draw.io add-on is downloaded from its upstream project (the current `draw.war` release) when you turn it on in settings, and deleted when you turn it off. Releases and builds no longer include it.
- Monaco 0.57 is built into `main.js`; the Code editor setting is a plain toggle and downloads nothing.

## [0.1.0]

- First release.
- Diagrams and storyboards from YAML in `flowmotion` code blocks, rendered as animated SVG.
- Optional add-ons, off by default: a draw.io editor for `.drawio.flow` files and a Monaco code editor.
- Works without add-ons: draw.io files show a message, and CodeMirror remains available when the Rich Code Editor is off.
