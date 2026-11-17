# Changelog

## [1.0.0]

- The draw.io add-on is downloaded from its upstream project (the current `draw.war` release) when you turn it on in settings, and deleted when you turn it off. Releases and builds no longer include it.
- Monaco 0.57 is now built into `main.js`. The Code editor setting is a plain toggle and downloads nothing.

## [0.1.0]

- First release.
- Diagrams and storyboards from YAML in `flowmotion` code blocks, rendered as animated SVG.
- Optional add-ons, off by default: a draw.io editor for `.drawio.flow` files and a Monaco code editor.
- Works without the add-on: draw.io files show a message, and a plain text box stands in for the code editor when it is off.
