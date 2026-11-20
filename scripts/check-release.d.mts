export type ReleaseManifest = {
  id: string;
  version: string;
  minAppVersion: string;
  description?: string;
};

export const RELEASE_FILES: string[];

export function checkRelease(input: {
  tag: string;
  manifest: ReleaseManifest;
  versions: Record<string, string>;
  files: string[];
}): string[];
