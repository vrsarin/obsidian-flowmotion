# Security Policy

## Supported versions

Only the latest released version of FlowMotion gets security fixes.

## Report a vulnerability

Do not open a public issue for a security problem.

Report it privately through GitHub: open the repository's **Security** tab, then choose **Report a vulnerability**. Include:

- The FlowMotion version.
- The steps to reproduce the problem, and a sample diagram if one is needed.
- What an attacker could do with it.

You can expect an acknowledgment within a week. We will agree on a fix and a release date with you before we publish details.

## Scope notes

FlowMotion runs in Obsidian and does not send data over the network. The optional draw.io add-on starts a local server on `127.0.0.1` on desktop only. It serves files from the add-on folder and accepts GET requests only.
