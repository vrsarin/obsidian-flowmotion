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
// Keep the AMD reference across plugin reloads without replacing the host's require.
const monacoRequire = Symbol.for("flowmotion.monacoRequire");
type MonacoWindow = Window & {
  require?: MonacoRequire;
  [monacoRequire]?: MonacoRequire;
};

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
    const amdWindow = activeWindow as MonacoWindow;
    const doc = amdWindow.document;
    const url = await this.server.url();
    const cached = amdWindow[monacoRequire];
    const hostRequire = Object.getOwnPropertyDescriptor(amdWindow, "require");
    const script =
      cached || amdWindow.require?.config ? undefined : doc.createElement("script");
    try {
      if (script) {
        script.src = `${url}/min/vs/loader.js`;
        await new Promise<void>((resolve, reject) => {
          script.onload = () => resolve();
          script.onerror = () =>
            reject(new Error("the Monaco AMD loader script could not be loaded"));
          doc.head.appendChild(script);
        });
      }

      const amdRequire = cached ?? amdWindow.require;
      if (!amdRequire?.config)
        throw new Error("the Monaco AMD loader did not initialize");
      amdWindow[monacoRequire] = amdRequire;
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
    } finally {
      if (script) {
        // editor.main needs the AMD global during its initial evaluation.
        if (hostRequire) Object.defineProperty(amdWindow, "require", hostRequire);
        else delete amdWindow.require;
        script.remove();
      }
    }
  }

  private cleanup() {
    this.api?.purge();
    this.api = undefined;
    this.loading = undefined;
  }

  /** For plugin unload. */
  dispose() {
    this.refs = 0;
    this.cleanup();
  }
}
