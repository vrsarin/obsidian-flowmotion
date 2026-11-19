[![Security checks](https://github.com/vrsarin/obsidian-flowmotion/actions/workflows/security-audit.yml/badge.svg)](https://github.com/vrsarin/obsidian-flowmotion/actions/workflows/security-audit.yml)
[![SonarCloud Quality Gate](https://sonarcloud.io/api/project_badges/quality_gate?project=vrsarin_obsidian-flowmotion)](https://sonarcloud.io/summary/new_code?id=vrsarin_obsidian-flowmotion)

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

| Diagram             | Use it for                           |
| ------------------- | ------------------------------------ |
| Flowchart           | Systems, processes, decisions        |
| Sequence            | Who talks to whom, and in what order |
| Activity            | Step-by-step business workflows      |
| State               | Things that move between states      |
| Mind map            | Ideas and plans                      |
| Gantt               | Project timelines                    |
| C4 and architecture | Software and cloud landscapes        |
| Class and ER        | Data models                          |

Full syntax: [Writing diagrams](https://github.com/vrsarin/obsidian-flowmotion/wiki/Writing-Diagrams).

## Optional add-ons

FlowMotion works out of the box. The optional draw.io editor is downloaded from its upstream project when you turn it on, and is not part of FlowMotion releases:

- **draw.io editor** for `.drawio.flow` files, downloaded as the current `draw.war` from the [draw.io GitHub releases](https://github.com/jgraph/drawio/releases) (about 42 MB installed).
  To use it, open FlowMotion settings and turn it on. FlowMotion downloads it into the plugin folder (a network connection is needed once). Turn it off to delete the files. It works on the desktop app only.

FlowMotion uses CodeMirror for `.flow` files and the diagram edit window. It includes YAML syntax highlighting, line numbers, a live preview, and formatting with **Shift+Alt+F**. It works offline and on mobile without an add-on.

On desktop, enable **Settings → FlowMotion → Rich Code Editor (Monaco)** for completion, hover help, and navigation. The first enable downloads the pinned package published by the [Monaco Editor project](https://github.com/microsoft/monaco-editor) to npm. Reopen the diagram after installation. Monaco works offline after installation. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for licenses.

## Data access

- Opening the diagram picker enumerates `.flow` files; it enumerates vault folders when showing the new-file destination list. Filtering the picker uses that opening-time file list. Path completion searches vault file names for `.flow`, YAML, and JSON files only when completing a `src:` path.
- The optional Monaco add-on includes clipboard support for editing and clipboard-aware suggestions. FlowMotion does not call the clipboard API directly.
- The optional draw.io editor is downloaded into the plugin folder through the vault adapter. A local server bound to `127.0.0.1` serves those files to the editor.

## Advanced

See the wiki for [reusing diagram files](https://github.com/vrsarin/obsidian-flowmotion/wiki/Reusing-Diagrams), [backgrounds](https://github.com/vrsarin/obsidian-flowmotion/wiki/Appearance-and-Backgrounds), [editor support](https://github.com/vrsarin/obsidian-flowmotion/wiki/Developer-Schema-and-Validation), and [build commands](https://github.com/vrsarin/obsidian-flowmotion/wiki/Developer-Setup). The full YAML format is in [Advanced: YAML format](https://github.com/vrsarin/obsidian-flowmotion/wiki/Advanced-YAML-Format).

## Status

See [CHANGELOG.md](CHANGELOG.md) for version history. Automated tests cover the drawing engine and selected Obsidian desktop workflows, including loading, SVG rendering, settings, and restart persistence. Mobile use and full optional-editor workflows still need manual checks. Test it in a copy of your vault first. See [Known limitations](https://github.com/vrsarin/obsidian-flowmotion/wiki/Known-Limitations).

## Security

Pull requests to `main`, `release/**`, and `hotfix/**`, and pushes to `main`, run the repository's automated checks. The active `main` and release rulesets require the **Security gate** status check before merging. The [Security checks workflow](https://github.com/vrsarin/obsidian-flowmotion/actions/workflows/security-audit.yml) runs ESLint with the Obsidian plugin and security rules, build, typecheck, tests, Semgrep, Snyk Open Source and Code, SonarCloud, and GitHub Dependency Review. A secretless `npm audit` check blocks moderate-or-higher vulnerabilities across the dependency lockfile, including on fork pull requests; Dependency Review provides context about package changes. Same-repository pull requests also run Snyk at the medium severity threshold, including development dependencies. Snyk SARIF findings are uploaded to [GitHub Code scanning](https://github.com/vrsarin/obsidian-flowmotion/security/code-scanning). Public-fork pull requests run Semgrep Community Edition; Semgrep AppSec Platform, Snyk, and SonarCloud require repository secrets and are skipped for those PRs.

The [SonarCloud quality gate](https://sonarcloud.io/summary/new_code?id=vrsarin_obsidian-flowmotion) shows the current server-side analysis result. Configure the repository's `SONAR_TOKEN`, `SEMGREP_APP_TOKEN`, and `SNYK_TOKEN` under **Settings → Secrets and variables → Actions** for the credentialed jobs to run. In Semgrep AppSec Platform, configure which findings are blocking; `semgrep ci --no-suppress-errors` fails the job on blocking findings and scanner errors. A scan result is evidence about that revision and scanner configuration; it does not prove the project is vulnerability-free.

### Aikido and the IDE

The VS Code workspace recommends ESLint, Aikido Security, Semgrep, SonarQube for IDE, and Snyk Security. Install the recommendations when VS Code prompts, then sign in to each provider from its extension. SonarQube for IDE is bound to the SonarCloud project; complete the one-time connection in VS Code using the `vrsarin` connection and project `vrsarin_obsidian-flowmotion`.

Aikido's cloud PR checks are configured from the Aikido dashboard using its GitHub PR Checks app. To make Aikido findings block merges too, enable PR scans for this repository in Aikido and add the resulting Aikido check as a required status check in the `main` ruleset. Aikido's local-scanner GitHub Action is for local/on-prem scanning, so this workflow does not claim to run it. The Aikido dashboard may require sign-in; the public GitHub workflow and Code scanning pages provide public evidence for the checks that run in Actions.

To reproduce the repository lint locally, run `npm ci` and `npm run lint`. A clean lint run is evidence that the configured ESLint rules passed for that checkout; it does not replace the provider scan links above.

## Contributing

Bug reports and ideas are welcome. Open an issue on GitHub.

Run `make test-e2e` to build the plugin and test it in downloaded Obsidian desktop builds.
On macOS, the E2E configuration prioritizes `/usr/bin` so installer setup uses Apple's `xattr`, not Python's incompatible command.

See the wiki for [testing and examples](https://github.com/vrsarin/obsidian-flowmotion/wiki/Developer-Testing-and-Examples) and [releases and CI](https://github.com/vrsarin/obsidian-flowmotion/wiki/Developer-Releases-and-CI).

## License

See [LICENSE](LICENSE).
