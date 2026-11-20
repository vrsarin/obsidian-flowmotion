import { Platform } from "obsidian";
import * as monaco from "monaco-editor/editor/editor.api";
import * as yaml from "monaco-editor/languages/definitions/yaml/yaml";
import "monaco-editor/editor/contrib/contextmenu/browser/contextmenu.js";
import "monaco-editor/editor/contrib/format/browser/formatActions.js";
import { init, mount, purge } from "../monaco/entry";

export interface MonacoApi {
  mount(
    host: HTMLElement,
    opts: import("../monaco/entry").MountOptions,
  ): import("../monaco/entry").Handle;
  purge(): void;
}

// Monaco is part of the signed plugin bundle. Loading it through a runtime script
// element would let downloaded files execute as code in the Obsidian window.
init(monaco, yaml);

/** Provides the bundled optional code editor on desktop and a safe fallback elsewhere. */
export class MonacoLoader {
  private refs = 0;
  private readonly api: MonacoApi = { mount, purge };

  installed(): Promise<boolean> {
    return Promise.resolve(Platform.isDesktopApp);
  }

  async acquire(): Promise<MonacoApi> {
    if (!(await this.installed()))
      throw new Error("the code editor works on the desktop app only");
    this.refs++;
    return this.api;
  }

  release() {
    if (this.refs > 0 && --this.refs === 0) this.api.purge();
  }

  /** For plugin unload. */
  dispose() {
    this.refs = 0;
    this.api.purge();
  }
}
