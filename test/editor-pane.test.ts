// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { EditorPane } from "../src/obsidian/editor-pane";
import { FLOW_TEMPLATE } from "../src/core/template";
import { formatSource } from "../src/schema/format";

describe("diagram editor pane", () => {
  let pane: EditorPane | undefined;
  afterEach(() => {
    pane?.destroy();
    pane = undefined;
    document.body.replaceChildren();
  });

  function open(source: string) {
    const parent = document.body.createDiv();
    const onChange = vi.fn();
    const editor = (pane = new EditorPane(parent, {
      app: { vault: { getAbstractFileByPath: () => null } } as never,
      autoplay: false,
      speed: 1,
      onChange,
    }));
    editor.set(source);
    const view = EditorView.findFromDOM(parent.querySelector(".cm-editor")!);
    if (!view) throw new Error("CodeMirror view not found");
    return { parent, editor, view, onChange };
  }

  it("uses Obsidian CodeMirror by default and renders the live preview", async () => {
    const { parent } = open(FLOW_TEMPLATE);
    await vi.waitFor(() => {
      expect(parent.querySelector(".cm-editor")).not.toBeNull();
      expect(parent.querySelector(".cm-gutters .cm-lineNumbers")).not.toBeNull();
      expect(parent.querySelector(".cm-content .tok-propertyName")).not.toBeNull();
      expect(parent.querySelector(".fm-flow-preview svg")).not.toBeNull();
    });
    expect(parent.querySelector("textarea")).toBeNull();
  });

  it.each(["nodes: []", "nodes: [] # edit", ""])(
    "resets undo without notifying autosave when loading %j",
    (next) => {
      const { editor, view, onChange } = open("nodes: []");
      view.dispatch({ changes: { from: view.state.doc.length, insert: " # edit" } });
      expect(onChange).toHaveBeenLastCalledWith("nodes: [] # edit");
      onChange.mockClear();

      editor.set(next);

      expect(view.state.doc.toString()).toBe(next);
      expect(undo(view)).toBe(false);
      expect(editor.getValue()).toBe(next);
      expect(onChange).not.toHaveBeenCalled();
    },
  );

  it("formats on Shift+Alt+F and undoes formatting separately from typing", () => {
    const { editor, view, onChange } = open(FLOW_TEMPLATE);
    view.dispatch({ changes: { from: 0, insert: "\n" } });
    const edited = editor.getValue();
    const formatted = formatSource(edited);
    expect(formatted).toBeDefined();
    expect(formatted).not.toBe(edited);

    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", {
      key: "F", code: "KeyF", shiftKey: true, altKey: true,
      bubbles: true, cancelable: true,
    }));

    expect(editor.getValue()).toBe(formatted);
    expect(onChange).toHaveBeenLastCalledWith(formatted);
    expect(undo(view)).toBe(true);
    expect(editor.getValue()).toBe(edited);
    expect(undo(view)).toBe(true);
    expect(editor.getValue()).toBe(FLOW_TEMPLATE);
  });
});
