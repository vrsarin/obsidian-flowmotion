// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorPane } from "../src/obsidian/editor-pane";
import { FLOW_TEMPLATE } from "../src/core/template";

describe("diagram editor pane", () => {
  afterEach(() => document.body.replaceChildren());

  it("uses Obsidian CodeMirror by default and renders the live preview", async () => {
    const parent = document.body.createDiv();
    const pane = new EditorPane(parent, {
      app: { vault: { getAbstractFileByPath: () => null } } as never,
      autoplay: false,
      speed: 1,
      onChange: vi.fn(),
    });

    pane.set(FLOW_TEMPLATE);
    await vi.waitFor(() => {
      expect(parent.querySelector(".cm-editor")).not.toBeNull();
      expect(parent.querySelector(".cm-gutters .cm-lineNumbers")).not.toBeNull();
      expect(parent.querySelector(".cm-content .tok-propertyName")).not.toBeNull();
      expect(parent.querySelector(".fm-flow-preview svg")).not.toBeNull();
    });
    expect(parent.querySelector("textarea")).toBeNull();
    pane.destroy();
  });
});
