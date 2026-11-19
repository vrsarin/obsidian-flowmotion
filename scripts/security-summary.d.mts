export function summarizeSecurityReports(options?: {
  directory?: string;
  top?: number;
  log?: (message: string) => void;
}): number;
export function runSecuritySummaryCli(
  isMain: boolean,
  options?: Parameters<typeof summarizeSecurityReports>[0],
): void;
