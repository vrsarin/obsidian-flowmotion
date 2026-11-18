import { Platform } from "obsidian";
import type { DataAdapter } from "obsidian";
import type * as monaco from "monaco-editor/editor/editor.api";
import { init, mount, purge, type YamlDefinition } from "../monaco/entry";
import type { StaticServer } from "./static-server";
import { MONACO_YAML_MODULE } from "./addons";

export interface MonacoApi {
  mount(
    host: HTMLElement,
    opts: import("../monaco/entry").MountOptions,
  ): import("../monaco/entry").Handle;
  purge(): void;
}

type MonacoNamespace = typeof monaco;
type MonacoRequire = {
  (
    modules: string[],
    callback: (api: MonacoNamespace, yaml: YamlDefinition) => void,
    onError?: (error: Error) => void,
  ): void;
  config(options: { paths: { vs: string }; preferScriptTags: boolean }): void;
};
type MonacoWindow = Window & { require?: MonacoRequire };

/**
 * Loads Monaco's optional AMD distribution from the npm package on first use.
 * Desktop only: on mobile the CodeMirror editor is used.
 */
export class MonacoLoader {
  private api?: MonacoApi;
  private loading?: Promise<MonacoApi>;
  private refs = 0;

  constructor(
    private server: Pick<StaticServer, "url">,
    private adapter: Pick<DataAdapter, "exists">,
    private pluginDir: string,
  ) {}

  async acquire(): Promise<MonacoApi> {
    this.refs++;
    try {
      return await (this.loading ??= this.load());
    } catch (e) {
      this.refs--;
      this.loading = undefined;
      throw e;
    }
  }

  release() {
    if (this.refs > 0 && --this.refs === 0) this.cleanup();
  }

  /** True when this device can run the code editor. */
  async installed(): Promise<boolean> {
    return (
      Platform.isDesktopApp &&
      this.adapter.exists(`${this.pluginDir}/monaco/min/vs/loader.js`)
    );
  }

  private async load(): Promise<MonacoApi> {
    if (!Platform.isDesktopApp)
      throw new Error("the code editor works on the desktop app only");
    const url = await this.server.url();
    const amdWindow = activeWindow as MonacoWindow;
    if (!amdWindow.require?.config) {
      const script = activeDocument.createElement("script");
      script.src = `${url}/min/vs/loader.js`;
      try {
        await new Promise<void>((resolve, reject) => {
          script.onload = () => resolve();
          script.onerror = () =>
            reject(new Error("the Monaco AMD loader script could not be loaded"));
          activeDocument.head.appendChild(script);
        });
      } catch (e) {
        script.remove();
        throw e;
      }
    }

    const amdRequire = (activeWindow as MonacoWindow).require;
    if (!amdRequire?.config)
      throw new Error("the Monaco AMD loader did not initialize");
    amdRequire.config({
      paths: { vs: `${url}/min/vs` },
      preferScriptTags: true,
    });
    const [api, yaml] = await new Promise<[MonacoNamespace, YamlDefinition]>(
      (resolve, reject) => {
        amdRequire(
          ["vs/editor/editor.main", MONACO_YAML_MODULE],
          (monacoApi, yamlDefinition) => resolve([monacoApi, yamlDefinition]),
          reject,
        );
      },
    );
    init(api, yaml);
    this.api = { mount, purge };
    return this.api;
  }

  private cleanup() {
    this.api?.purge();
    this.api = undefined;
    this.loading = undefined;
    // Monaco's AMD modules and global loader stay available for later use.
    // Widgets Monaco attaches to <body> (menus, hovers, aria live regions).
    activeDocument.body
      .querySelectorAll(
        ":scope > .monaco-aria-container, :scope > .context-view, :scope > .monaco-menu-container, :scope > .shadow-root-host, :scope > .monaco-hover",
      )
      .forEach((n) => n.remove());
  }

  /** For plugin unload. */
  dispose() {
    this.refs = 0;
    this.cleanup();
  }
}
