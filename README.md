# FlowMotion

**Turn any system into a diagram that moves.**

FlowMotion draws architecture, process, and data-flow diagrams that come alive. Watch requests travel through your services, see where work waits, and spot the bottleneck at a glance.

- **Works in your notes.** Add a diagram to any [Obsidian](https://obsidian.md) note.
- **Simple to write.** Use the familiar Mermaid or PlantUML style.
- **Animated.** Each arrow carries a packet. Each step takes time. Each node waits for its inputs.
- **Offline.** No account, no cloud, no internet connection needed.
- **Light and dark.** Diagrams match your theme.

## See it in action

````markdown
```flowmotion
flowchart TB
  user((User)) -->|request| gw{Gateway}
  subgraph platform [Platform]
    gw -->|ok| api[API Service]
    api --> db[(Orders DB)]
  end
  %% @duration db 700
```
````

Paste this into a note, switch to reading view, and press play.

## Get started in 5 minutes

You need two things: [Node.js](https://nodejs.org) (the LTS version) and [Obsidian](https://obsidian.md).

**1. Download FlowMotion.**
On the GitHub page, click **Code → Download ZIP**. Unzip the file.

**2. Open a terminal in the FlowMotion folder.**

- Mac: open **Terminal**, type `cd` followed by a space, drag the FlowMotion folder into the window, and press Enter.
- Windows: open the FlowMotion folder in File Explorer, click the address bar, type `cmd`, and press Enter.

**3. Build FlowMotion.** Type these two commands, pressing Enter after each:

```bash
npm install
npm run build
```

**4. Install it in your Obsidian vault.** Replace the path with the folder that contains your notes (your vault):

```bash
npm run install-plugin -- "/path/to/your/vault"
```

**5. Turn it on in Obsidian.**

1. Open **Settings → Community plugins**.
2. Turn off **Restricted mode** if it is on.
3. Enable **FlowMotion**.

That's it. Create a note and paste a diagram from the example above.

## Your first diagram

1. Open a note.
2. Right-click in the note and choose **Add FlowMotion diagram**.
3. Choose **Inline diagram**.
4. Edit the text. The preview updates as you type.

To edit a diagram with help (autocomplete, error checks, and a live preview), hover over it and click **✎ Edit**.

## What you can draw

| Diagram | Use it for |
| --- | --- |
| Flowchart | Systems, processes, decisions |
| Sequence | Who talks to whom, and in what order |
| Activity | Step-by-step business workflows |
| State | Things that move between states |
| Mind map | Ideas and plans |
| Gantt | Project timelines |
| C4 and architecture | Software and cloud landscapes |
| Class and ER | Data models |

Full syntax: [Writing diagrams](https://github.com/vrsarin/obsidian-flowmotion/wiki/Writing-Diagrams).

## Optional add-ons

FlowMotion works out of the box. The optional desktop editors are built from their upstream sources and are not included in FlowMotion releases:

- **draw.io editor** for `.drawio.flow` files (desktop app only).
- **Code editor** (Monaco) with syntax help for diagram code (desktop app only).

The build downloads draw.io from the [draw.io source repository](https://github.com/jgraph/drawio) and Monaco from the [`monaco-editor` npm package](https://www.npmjs.com/package/monaco-editor). From the FlowMotion source folder, run these commands before installing the plugin:

```bash
npm run fetch-drawio
npm run build
npm run install-plugin -- "/path/to/your/vault"
```

Then open FlowMotion settings and turn on the add-on you want. Without the files, FlowMotion uses a plain text box for code editing and shows a notice for draw.io files. draw.io and Monaco are licensed under Apache-2.0 and MIT; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Advanced

See the wiki for [reusing diagram files](https://github.com/vrsarin/obsidian-flowmotion/wiki/Reusing-Diagrams), [backgrounds](https://github.com/vrsarin/obsidian-flowmotion/wiki/Appearance-and-Backgrounds), [editor support](https://github.com/vrsarin/obsidian-flowmotion/wiki/Developer-Schema-and-Validation), and [build commands](https://github.com/vrsarin/obsidian-flowmotion/wiki/Developer-Setup). The full YAML format is in [Advanced: YAML format](https://github.com/vrsarin/obsidian-flowmotion/wiki/Advanced-YAML-Format).

## Status

FlowMotion is version 0.1.0. Automated tests cover the drawing engine and selected Obsidian desktop workflows, including loading, SVG rendering, settings, and restart persistence. Mobile use and full optional-editor workflows still need manual checks. Test it in a copy of your vault first. See [Known limitations](https://github.com/vrsarin/obsidian-flowmotion/wiki/Known-Limitations).

## Contributing

Bug reports and ideas are welcome. Open an issue on GitHub.

Run `make test-e2e` to build the plugin and test it in downloaded Obsidian desktop builds.
On macOS, the E2E configuration prioritizes `/usr/bin` so installer setup uses Apple's `xattr`, not Python's incompatible command.

See the wiki for [testing and examples](https://github.com/vrsarin/obsidian-flowmotion/wiki/Developer-Testing-and-Examples) and [releases and CI](https://github.com/vrsarin/obsidian-flowmotion/wiki/Developer-Releases-and-CI).

## License

See [LICENSE](LICENSE).
