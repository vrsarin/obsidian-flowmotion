// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import { chooseDiagramFile } from "../src/obsidian/file-dialog";

describe("diagram file picker", () => {
  it("enumerates .flow files once, reuses the list while filtering, and selects the current vault file", async () => {
    const file = Object.assign(new TFile(), {
      path: "diagrams/architecture.flow",
      extension: "flow",
      basename: "architecture",
    });
    const getFiles = vi.fn(() => [file]);
    const getAbstractFileByPath = vi.fn(() => file);
    const app = {
      vault: { getFiles, getAllLoadedFiles: () => [], getAbstractFileByPath },
    };

    const choice = chooseDiagramFile(app as never, "/");

    expect(getFiles).toHaveBeenCalledTimes(1);
    const filter = document.querySelector<HTMLInputElement>(".fm-pick-filter")!;
    filter.value = "architecture";
    filter.dispatchEvent(new Event("input"));
    expect(getFiles).toHaveBeenCalledTimes(1);
    document.querySelector<HTMLElement>(".fm-pick-file")!.click();

    await expect(choice).resolves.toEqual({ kind: "existing", file });
    expect(getAbstractFileByPath).toHaveBeenCalledWith(file.path);
  });

  it("removes cached files that no longer exist or are no longer .flow files", () => {
    const file = Object.assign(new TFile(), {
      path: "diagrams/architecture.flow",
      extension: "flow",
      basename: "architecture",
    });
    const noLongerFlow = Object.assign(new TFile(), {
      path: file.path,
      extension: "md",
    });

    for (const currentFile of [null, noLongerFlow]) {
      document.body.replaceChildren();
      const getFiles = vi.fn(() => [file]);
      const getAbstractFileByPath = vi.fn(() => currentFile);
      const app = {
        vault: { getFiles, getAllLoadedFiles: () => [], getAbstractFileByPath },
      };

      void chooseDiagramFile(app as never, "/");
      document.querySelector<HTMLElement>(".fm-pick-file")!.click();

      expect(getFiles).toHaveBeenCalledTimes(1);
      expect(getAbstractFileByPath).toHaveBeenCalledWith(file.path);
      expect(document.querySelector(".fm-pick-file")).toBeNull();
      expect(document.querySelector(".fm-pick-empty")?.textContent).toBe(
        "No matching .flow files.",
      );
    }
  });
});
