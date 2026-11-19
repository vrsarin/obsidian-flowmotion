// Summarises reports in .security/ (SARIF from Semgrep/Snyk, JSON from Sonar).
import { existsSync, readdirSync, readFileSync } from "node:fs";

const dir = ".security";
const top = Number(process.env.TOP ?? 10);
if (!existsSync(dir)) { console.log("No .security/ reports. Run make security first."); process.exit(0); }
const files = readdirSync(dir);

const rank = { error: 0, warning: 1, note: 2, none: 3 };
let blocking = 0;

for (const f of files.filter((n) => n.endsWith(".skipped"))) {
  console.log(`\n== ${f.replace(".skipped", "")} ==\n  ${readFileSync(`${dir}/${f}`, "utf8").trim()}`);
}

for (const f of files.filter((n) => n.endsWith(".sarif"))) {
  const sarif = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
  const results = (sarif.runs ?? []).flatMap((r) => r.results ?? []);
  const counts = {};
  for (const r of results) counts[r.level ?? "warning"] = (counts[r.level ?? "warning"] ?? 0) + 1;
  blocking += (counts.error ?? 0) + (counts.warning ?? 0);
  console.log(`\n== ${f} == ${results.length} finding(s) ${JSON.stringify(counts)}`);
  results
    .sort((a, b) => (rank[a.level ?? "warning"] ?? 1) - (rank[b.level ?? "warning"] ?? 1))
    .slice(0, top)
    .forEach((r) => {
      const loc = r.locations?.[0]?.physicalLocation;
      const where = loc ? `${loc.artifactLocation?.uri}:${loc.region?.startLine ?? "?"}` : "";
      console.log(`  [${r.level ?? "warning"}] ${r.ruleId} ${where}\n      ${(r.message?.text ?? "").split("\n")[0].slice(0, 140)}`);
    });
}

if (files.includes("sonar-issues.json")) {
  const { issues = [], total = 0 } = JSON.parse(readFileSync(`${dir}/sonar-issues.json`, "utf8"));
  const counts = {};
  for (const i of issues) counts[i.severity] = (counts[i.severity] ?? 0) + 1;
  blocking += issues.length;
  console.log(`\n== sonar == ${total} open issue(s) ${JSON.stringify(counts)}`);
  issues.slice(0, top).forEach((i) =>
    console.log(`  [${i.severity}] ${i.rule} ${i.component.split(":").pop()}:${i.line ?? "?"}\n      ${i.message.slice(0, 140)}`));
}

if (files.includes("aikido.txt")) console.log("\n== aikido ==\n  see .security/aikido.txt");
console.log(`\n${blocking} finding(s) at warning level or above. Full reports: ${dir}/`);
