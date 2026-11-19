#!/usr/bin/env bash
# Local security scans. Usage: scripts/security-scan.sh <semgrep|snyk|sonar|aikido>
# Reports go to .security/. Tokens come from the environment or .security.env (gitignored).
set -uo pipefail
cd "$(dirname "$0")/.."

[ -f .security.env ] && { set -a; . ./.security.env; set +a; }

OUT=.security
mkdir -p "$OUT"
tool="${1:-}"

SONAR_HOST="${SONAR_HOST_URL:-https://sonarcloud.io}"
SONAR_ORG="${SONAR_ORG:-vrsarin}"
SONAR_PROJECT="${SONAR_PROJECT:-vrsarin_obsidian-flowmotion}"
# Never analyse local code into the main branch: use a dedicated branch name.
SONAR_BRANCH="${SONAR_BRANCH:-local-scan}"

skip() { echo "SKIPPED $tool: $1" | tee "$OUT/$tool.skipped"; exit 0; }
rm -f "$OUT/$tool.skipped"

case "$tool" in
semgrep)
  command -v semgrep >/dev/null || skip "semgrep not installed (brew install semgrep)"
  semgrep scan --config p/security-audit --config p/typescript --config p/nodejs \
    --metrics=off --quiet --sarif --output "$OUT/semgrep.sarif" src scripts e2e .github
  ;;
snyk)
  [ -n "${SNYK_TOKEN:-}" ] || skip "SNYK_TOKEN not set"
  snyk=(snyk); command -v snyk >/dev/null || snyk=(npx --yes snyk@latest)
  "${snyk[@]}" test --all-projects --severity-threshold=medium \
    --sarif-file-output="$OUT/snyk-oss.sarif" >"$OUT/snyk-oss.txt" 2>&1
  oss=$?
  "${snyk[@]}" code test --severity-threshold=medium \
    --sarif-file-output="$OUT/snyk-code.sarif" >"$OUT/snyk-code.txt" 2>&1
  code=$?
  echo "snyk exit codes: oss=$oss code=$code (1 = findings, >1 = tool error; see $OUT/snyk-*.txt)"
  [ "$oss" -le 1 ] && [ "$code" -le 1 ]
  ;;
sonar)
  [ -n "${SONAR_TOKEN:-}" ] || skip "SONAR_TOKEN not set"
  scanner=(sonar-scanner); command -v sonar-scanner >/dev/null || scanner=(npx --yes @sonar/scan)
  "${scanner[@]}" -Dsonar.host.url="$SONAR_HOST" -Dsonar.organization="$SONAR_ORG" \
    -Dsonar.projectKey="$SONAR_PROJECT" -Dsonar.sources=src -Dsonar.branch.name="$SONAR_BRANCH" \
    -Dsonar.qualitygate.wait=true >"$OUT/sonar-scan.txt" 2>&1
  rc=$?
  tail -n 5 "$OUT/sonar-scan.txt"
  # A failed scan means no analysis to query; an empty issue list would read as "clean".
  grep -q "Automatic Analysis is enabled" "$OUT/sonar-scan.txt" && \
    echo "Fix: SonarCloud > project > Administration > Analysis Method > turn off Automatic Analysis"
  grep -q "EXECUTION FAILURE\|Scanner engine failed" "$OUT/sonar-scan.txt" && exit 1
  curl -fsS -H "Authorization: Bearer $SONAR_TOKEN" \
    "$SONAR_HOST/api/issues/search?organization=$SONAR_ORG&componentKeys=$SONAR_PROJECT&branch=$SONAR_BRANCH&resolved=false&ps=500" \
    -o "$OUT/sonar-issues.json" || echo "could not fetch Sonar issues"
  exit $rc
  ;;
aikido)
  [ -n "${AIKIDO_API_KEY:-}" ] || skip "AIKIDO_API_KEY not set"
  cmd="${AIKIDO_CMD:-aikido-local-scanner}"
  command -v "$cmd" >/dev/null || skip "$cmd not installed (see Aikido local scanner docs; set AIKIDO_CMD to override)"
  "$cmd" scan . --apikey "$AIKIDO_API_KEY" 2>&1 | tee "$OUT/aikido.txt"
  exit "${PIPESTATUS[0]}"
  ;;
*)
  echo "usage: $0 <semgrep|snyk|sonar|aikido>" >&2; exit 2 ;;
esac
