import type { App } from 'obsidian';

export type AddonId = 'drawio' | 'monaco';
export interface AddonStatus { drawio: boolean; monaco: boolean }

/** Where an add-on comes from. */
export interface AddonSource {
  /** Upstream download. */
  url: string;
  /** Human-readable name and version, written to VERSION. */
  label: string;
  /** Archive format. ZIP is the default. */
  archive?: 'tar.gz';
  /** Small extra files saved next to the add-on, such as its licence. */
  extras?: { url: string; name: string }[];
}

export interface AddonSpec {
  /** Folder inside the plugin folder. */
  dir: string;
  /** A file that exists once the add-on is installed. */
  marker: string;
  /** Chooses what to download. `text` fetches a small text file over https. */
  resolve(text: (url: string) => Promise<string>, version?: string): Promise<AddonSource>;
  /** Single-file downloads are saved directly, instead of being extracted as a ZIP archive. */
  file?: string;
  /** Maps a path inside the archive to a path inside `dir`, or null to skip it. */
  target(path: string): string | null;
}

// Only what the embedded editor loads. Cloud integrations, viewers, templates and sources stay out.
// The stencils/*.xml sources are left out: js/stencils.min.js already contains them.
const DRAWIO_FILES = /^(index\.html|favicon\.ico|(styles|images|img|shapes|plugins)\/.+|stencils\/(LICENSE|clipart\/.+)|js\/(bootstrap|main|PreConfig|PostConfig|app\.min|extensions\.min|stencils\.min|orgchart\.min)\.js|js\/shapes-[\w.-]+\.min\.js|resources\/dia(_en)?\.txt)$/;

/** draw.io publishes its current version in the VERSION file and the matching webapp as draw.war on that version's GitHub release. */
export const DRAWIO: AddonSpec = {
  dir: 'drawio',
  marker: 'index.html',
  async resolve(text) {
    const version = (await text('https://raw.githubusercontent.com/jgraph/drawio/dev/VERSION')).trim();
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('could not read the draw.io version');
    return {
      url: `https://github.com/jgraph/drawio/releases/download/v${version}/draw.war`,
      label: `draw.io ${version} (github.com/jgraph/drawio, Apache-2.0)`,
      extras: [{ url: `https://raw.githubusercontent.com/jgraph/drawio/v${version}/LICENSE`, name: 'LICENSE' }],
    };
  },
  target: (path) => DRAWIO_FILES.test(path) ? path : null,
};

export const MONACO_VERSION = '0.57.0';
export const MONACO_YAML_MODULE = 'vs/yaml-C-RIivnc';

export const MONACO: AddonSpec = {
  dir: 'monaco',
  marker: 'min/vs/loader.js',
  async resolve() {
    return {
      url: `https://registry.npmjs.org/monaco-editor/-/monaco-editor-${MONACO_VERSION}.tgz`,
      label: `Monaco Editor ${MONACO_VERSION} (npm, MIT)`,
      archive: 'tar.gz',
    };
  },
  target: (path) => {
    if (path === 'package/LICENSE') return 'LICENSE';
    const prefix = 'package/min/vs/';
    if (!path.startsWith(prefix) || path.endsWith('.map')) return null;
    return path.slice('package/'.length);
  },
};

export const ADDONS: Record<AddonId, AddonSpec> = { drawio: DRAWIO, monaco: MONACO };

/** Checks which optional add-ons are installed in the plugin folder. */
export async function addonStatus(app: App, pluginDir: string): Promise<AddonStatus> {
  return {
    drawio: await app.vault.adapter.exists(`${pluginDir}/${DRAWIO.dir}/${DRAWIO.marker}`),
    // Monaco is bundled with the plugin and never downloaded or executed at runtime.
    monaco: true,
  };
}
