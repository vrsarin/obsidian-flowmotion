// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import { chooseDiagramFile } from '../src/obsidian/file-dialog';

describe('diagram file picker', () => {
  it('enumerates .flow files when opened and reuses that list while filtering', () => {
    const file = Object.assign(new TFile(), { path: 'diagrams/architecture.flow', extension: 'flow', basename: 'architecture' });
    const getFiles = vi.fn(() => [file]);
    const app = { vault: { getFiles, getAllLoadedFiles: () => [], getAbstractFileByPath: () => null } };

    void chooseDiagramFile(app as never, '/');

    expect(getFiles).toHaveBeenCalledTimes(1);
    const filter = document.querySelector<HTMLInputElement>('.fm-pick-filter')!;
    filter.value = 'architecture';
    filter.dispatchEvent(new Event('input'));
    expect(getFiles).toHaveBeenCalledTimes(1);
  });
});
