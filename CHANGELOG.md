# Changelog

## [1.0.2]

- CodeMirror is the default editor for `.flow` files and the diagram edit window. It includes YAML syntax highlighting, line numbers, and a live preview, with no add-on download.
- Monaco is an optional desktop add-on. FlowMotion downloads the pinned Monaco Editor package from npm when you enable **Rich Code Editor (Monaco)**.
- Press **Shift+Alt+F** to format a diagram in CodeMirror. Undo can reverse formatting separately from typing.
- Opening or clearing a document resets undo history so an undo cannot restore another file's contents.
- Fixed the transparent Monaco context menu, kept Monaco loading in the window where it started, and limited cleanup to FlowMotion's own Monaco editors.

## [1.0.0]

- Monaco 0.57 is built into `main.js`; the Code editor setting is a plain toggle and downloads nothing.
- The draw.io add-on is downloaded from its upstream project (the current `draw.war` release) when you turn it on in settings, and deleted when you turn it off. Releases and builds no longer include it.

## [0.1.0]

- First release.
- Diagrams and storyboards from YAML in `flowmotion` code blocks, rendered as animated SVG.
- Optional add-ons, off by default: a draw.io editor for `.drawio.flow` files and a Monaco code editor.
- Works without add-ons: draw.io files show a message, and CodeMirror remains available when the Rich Code Editor is off.
