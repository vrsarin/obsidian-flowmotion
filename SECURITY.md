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

On protected `main` and `release/**` branches, the required **Security gate** blocks pull requests when Snyk reports medium-or-higher findings on same-repository pull requests, or when Dependency Review finds a moderate-or-higher vulnerable dependency change. Dependency Review also runs on public-fork pull requests without repository secrets. Snyk credentials are not exposed to forks. The workflow also runs on `hotfix/**`, but that branch pattern does not currently have a ruleset requiring the gate.

| Severity | Triage target | Remediation target |
| --- | --- | --- |
| Critical | Within 1 business day | Block release; fix or mitigate immediately and before release |
| High | Within 2 business days | Block release; fix within 7 calendar days and before release |
| Medium | Within 5 business days | Fix within 30 calendar days or before the next release, whichever comes first |
| Low | During the next weekly dependency review | Schedule with routine maintenance |

Temporary exceptions require maintainer approval and a tracking pull request or issue with the affected package/advisory, rationale, mitigation, owner, and review/expiry date. Exceptions expire within 30 calendar days and must be fixed, re-approved, or withdrawn by then. Keep details of an unpatched FlowMotion vulnerability in a private Security Advisory.

### Safe validation

To exercise the dependency policy, use a temporary branch and draft pull request; never merge it. Add a package version with a currently known moderate-or-higher advisory, then confirm that Dependency Review fails and the required **Security gate** fails. For a same-repository pull request with `SNYK_TOKEN` configured, also confirm that the Snyk scan reports the finding. Update to a fixed version, confirm the checks pass, and close the draft pull request. CI uses `npm ci --ignore-scripts`; do not run the vulnerable package or its scripts locally.

## Malicious package coverage

[Snyk Open Source](https://docs.snyk.io/scan-fix-and-prevent/scan-with-snyk/snyk-open-source) analyzes dependency vulnerabilities and licenses, and [GitHub Dependency Review](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependency-review) checks dependency changes against known vulnerability data. Snyk Code scans FlowMotion's source. These checks do not establish that a package is safe from malicious behavior, unknown threats, or typosquatting. The lockfile records package integrity values, and CI installs dependencies with lifecycle scripts disabled, reducing installation-time script execution but not detecting malicious package code that runs when imported.

**Future enhancement:** Evaluate a package-behavior scanner such as [Socket](https://socket.dev/features) to complement vulnerability scanning. Before a pilot, confirm plan eligibility, required permissions, and data access. For now, continue reviewing new packages and lockfile changes and keep Dependabot updates enabled.
