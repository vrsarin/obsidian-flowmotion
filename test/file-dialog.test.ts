// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import { chooseDiagramFile } from "../src/obsidian/file-dialog";

describe("diagram file picker", () => {
  it("resolves an entered vault path without enumerating files", async () => {
    const file = Object.assign(new TFile(), {
      path: "diagrams/architecture.flow",
      extension: "flow",
      basename: "architecture",
    });
    const getAbstractFileByPath = vi.fn(() => file);
    const getFiles = vi.fn(() => [file]);
    const getAllLoadedFiles = vi.fn(() => [file]);
    const app = {
      vault: { getFiles, getAllLoadedFiles, getAbstractFileByPath },
    };

    const choice = chooseDiagramFile(app as never, "/");
    const input = document.querySelector<HTMLInputElement>(".fm-existing-path")!;
    input.value = file.path;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

    await expect(choice).resolves.toEqual({ kind: "existing", file });
    expect(getAbstractFileByPath).toHaveBeenCalledWith(file.path);
    expect(getFiles).not.toHaveBeenCalled();
    expect(getAllLoadedFiles).not.toHaveBeenCalled();
  });

  it("rejects paths that do not resolve to a .flow file", () => {
    const getAbstractFileByPath = vi.fn(() => null);
    const app = { vault: { getAbstractFileByPath } };

    void chooseDiagramFile(app as never, "/");
    const input = document.querySelector<HTMLInputElement>(".fm-existing-path")!;
    input.value = "missing.flow";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

    expect(document.querySelector(".mod-warning")?.textContent).toBe(
      "Enter the path of an existing .flow file.",
    );
  });
});
