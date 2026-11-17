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

Full syntax: [docs/diagram-syntax.md](docs/diagram-syntax.md)

## Optional add-ons

FlowMotion works out of the box. Two features need extra files that you download separately, so the plugin itself never fetches code:

- **draw.io editor** for `.drawio.flow` files (desktop app only).
- **Code editor** (Monaco) with syntax help for diagram code (desktop app only).

To turn them on:

1. Download `flowmotion-addons.zip` from the [FlowMotion releases](https://github.com/vrsarin/obsidian-flowmotion/releases).
2. Unzip it into your plugin folder: `<vault>/.obsidian/plugins/flowmotion/`.
3. Open FlowMotion settings and turn on the add-on you want.

Without the files, the settings show a link to the download and FlowMotion uses a plain text box instead. draw.io and Monaco are licensed under Apache-2.0 and MIT; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Advanced

Reusing diagram files, draw.io backgrounds, the VS Code editor setup, and build commands are in [docs/advanced-configuration.md](docs/advanced-configuration.md). The full YAML format is in [docs/yaml-reference.md](docs/yaml-reference.md).

## Status

FlowMotion is version 0.1.0. The core drawing works and is tested. The Obsidian plugin has not yet been checked inside Obsidian, so test it in your vault first. See the known limits in [docs/advanced-configuration.md](docs/advanced-configuration.md#known-limits).

## Contributing

Bug reports and ideas are welcome. Open an issue on GitHub.

## License

See [LICENSE](LICENSE).
