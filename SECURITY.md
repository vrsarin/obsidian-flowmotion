# Security Policy

## Supported versions

Only the latest released version of FlowMotion gets security fixes.

## Report a vulnerability

Report it privately through [the repository's Security tab](https://github.com/vrsarin/obsidian-flowmotion/security), then choose **Report a vulnerability**. Do not open a public issue for a security problem. Include:

- The FlowMotion version.
- The steps to reproduce the problem, and a sample diagram if one is needed.
- What an attacker could do with it.

You can expect an acknowledgment within a week. We will agree on a fix and a release date with you before we publish details.

## Scope notes

FlowMotion runs in Obsidian and does not send data over the network. The optional draw.io add-on starts a local server on `127.0.0.1` on desktop only. It serves files from the add-on folder and accepts GET requests only.

## Dependency finding triage

The maintainer preparing the next release owns triage and remediation. If no release owner is assigned, the repository maintainer is responsible. Use the severity reported by Snyk or GitHub; resolve disagreements at the higher severity until reviewed.

On protected `main` and `release/**` branches, the required **Security gate** blocks pull requests when Snyk reports medium-or-higher findings on same-repository pull requests, or when `npm audit` finds a moderate-or-higher issue in the complete dependency lockfile. The audit runs without secrets, including on public-fork pull requests; Dependency Review provides context about package changes. Snyk scans production dependencies only, and its credentials are not exposed to forks. The workflow also runs on `hotfix/**`, but that branch pattern does not currently have a ruleset requiring the gate.

| Severity | Triage target | Remediation target |
| --- | --- | --- |
| Critical | Within 1 business day | Block release; fix or mitigate immediately and before release |
| High | Within 2 business days | Block release; fix within 7 calendar days and before release |
| Medium | Within 5 business days | Fix within 30 calendar days or before the next release, whichever comes first |
| Low | During the next weekly dependency review | Schedule with routine maintenance |

Temporary exceptions require maintainer approval and a tracking pull request or issue with the affected package/advisory, rationale, mitigation, owner, and review/expiry date. Exceptions expire within 30 calendar days and must be fixed, re-approved, or withdrawn by then. Keep details of an unpatched FlowMotion vulnerability in a private Security Advisory.

An optional validation scan with Snyk development-dependency scanning found three advisories in `uri-js@4.4.1` (`SNYK-JS-URIJS-19963961`, `SNYK-JS-URIJS-19963963`, and `SNYK-JS-URIJS-20341609`). Snyk reports no fixed release, and the current lockfile includes `uri-js` only in development dependency paths. These advisories are not ignored in `.snyk`; the required Snyk scan stays production-only. `npm audit` checks all lockfile dependencies but does not currently report these Snyk advisories.

### Safe validation

To exercise the dependency policy, use a temporary branch and draft pull request; never merge it. Add a package version with a currently known moderate-or-higher advisory, then confirm that `npm audit` and the required **Security gate** fail. Dependency Review provides change context but may not identify every advisory; it did not identify the test `lodash@4.17.20` finding. The required Snyk dependency scan covers production dependencies only. Remove or update the vulnerable dependency, confirm the checks pass, and close the draft pull request. CI uses `npm ci --ignore-scripts`; do not run the vulnerable package or its scripts locally.

## Malicious package coverage

[Snyk Open Source](https://docs.snyk.io/scan-fix-and-prevent/scan-with-snyk/snyk-open-source) analyzes dependency vulnerabilities and licenses, and [GitHub Dependency Review](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependency-review) checks dependency changes against known vulnerability data. Snyk Code scans FlowMotion's source. These checks do not establish that a package is safe from malicious behavior, unknown threats, or typosquatting. The lockfile records package integrity values, and CI installs dependencies with lifecycle scripts disabled, reducing installation-time script execution but not detecting malicious package code that runs when imported.

**Decision for this release:** Keep the existing Snyk and GitHub checks. Defer a Socket pilot until plan eligibility, required permissions, and data access are confirmed. Socket's [pricing page](https://socket.dev/pricing) lists malicious-dependency blocking in its Free plan, while GitHub Actions appears under Business; the public pricing does not establish whether the PR-level GitHub app is available on Free or the exact access it requires. Until verified, continue reviewing new packages and lockfile changes and keep Dependabot updates enabled.
