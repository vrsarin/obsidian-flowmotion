SHELL := /usr/bin/env bash

NPM ?= npm
ACT_RUNNER ?= catthehacker/ubuntu:act-latest
ACT_FLAGS ?= -P ubuntu-latest=$(ACT_RUNNER)
ACT_NODE ?= 24.x
ACT_SECRETS ?= .secrets
# Passes --secret-file only when the file exists; silently skipped otherwise.
_ACT_SECRET_FLAG = $(if $(wildcard $(ACT_SECRETS)),--secret-file $(ACT_SECRETS),)
LINT_WF ?= .github/workflows/lint.yml
RELEASE_WF ?= .github/workflows/release.yml

VAULT ?= /Users/viveksarin/Documents/Obsidian Vault

.PHONY: help build test lint release-check release-build \
	act-install act-secrets ci-list ci-dry-run ci-lint ci-release-build ci-release-dryrun ci-all \
	install-plugin security security-semgrep security-snyk security-sonar security-aikido security-summary security-clean

help:
	@echo "Build and check"
	@echo "  make build              Build main.js and styles.css"
	@echo "  make test               Run the unit tests"
	@echo "  make test-e2e           Run the end-to-end tests"
	@echo "  make lint               Run ESLint with the Obsidian rules"
	@echo "  make release-build      Install dependencies and build the plugin"
	@echo "  make release-check      Check the version and plugin files are ready to publish (TAG=0.1.0)"
	@echo "  make install-plugin     Copy the plugin into VAULT=\"/path/to/vault\""
	@echo ""
	@echo "Local security scans (tokens in .security.env: SNYK_TOKEN, SONAR_TOKEN, AIKIDO_API_KEY)"
	@echo "  make security           Run all scanners, then print a findings summary"
	@echo "  make security-semgrep   Semgrep only (no account needed)"
	@echo "  make security-snyk      Snyk dependencies and code"
	@echo "  make security-sonar     SonarCloud analysis on branch SONAR_BRANCH=local-scan"
	@echo "  make security-aikido    Aikido local scanner"
	@echo "  make security-summary   Re-print the summary of the last run"
	@echo ""
	@echo "Local CI via gh act (requires: gh cli + Docker Desktop)"
	@echo "  make act-install        Install the gh-act extension (one-time)"
	@echo "  make act-secrets        Create a .secrets template for act"
	@echo "  make ci-list            List all workflow jobs"
	@echo "  make ci-dry-run         Dry-run the push workflows without running steps"
	@echo "  make ci-lint            Run the lint workflow (build, lint, test) on Node $(ACT_NODE)"
	@echo "  make ci-release-build   Run the release workflow up to the publish step (no attest, no publish)"
	@echo "  make ci-release-dryrun  Dry-run the release workflow"
	@echo "  make ci-all             ci-lint then ci-release-build"
	@echo ""
	@echo "Variables"
	@echo "  ACT_NODE=<ver>      Node matrix entry for ci-lint. Default: $(ACT_NODE)"
	@echo "  ACT_RUNNER=<image>  Runner image. Default: $(ACT_RUNNER)"
	@echo "  TAG=<version>       Version to check. Default: manifest.json version"
	@echo "  VAULT=<path>        Vault for install-plugin"

build:
	$(NPM) run build

test:
	$(NPM) run test:coverage

test-e2e:
	$(NPM) run test:e2e

lint:
	$(NPM) run lint

release-build:
	$(NPM) ci
	$(NPM) run build

release-check:
	node scripts/check-release.mjs "$(or $(TAG),$(shell node -p "require('./manifest.json').version"))"

install-plugin: release-build
	@test -n "$(VAULT)" || { echo "Set VAULT=\"/path/to/vault\""; exit 2; }
	$(NPM) run install-plugin -- "$(VAULT)"

# ── Local CI via gh act ───────────────────────────────────────────────────────
# Runs GitHub Actions workflow jobs locally in Docker. Steps that need real GitHub
# (attestation, release publish, tag check) are skipped when ACT is set.
#
# First-time setup:
#   make act-install   installs the gh extension
#   make act-secrets   creates a .secrets file template

act-install:
	gh extension install https://github.com/nektos/gh-act || gh extension upgrade gh-act

act-secrets:
	@if [ -f $(ACT_SECRETS) ]; then \
	  echo "$(ACT_SECRETS) already exists. Edit it to update your token."; \
	else \
	  printf 'GITHUB_TOKEN=replace-with-your-token\n' > $(ACT_SECRETS) && \
	  echo "Created $(ACT_SECRETS). Replace the placeholder with a real token."; \
	fi

ci-list:
	gh act -l $(ACT_FLAGS)

ci-dry-run:
	gh act push -n -W $(LINT_WF) $(ACT_FLAGS)
	gh act push -n -W $(RELEASE_WF) $(ACT_FLAGS)

ci-lint:
	gh act push -W $(LINT_WF) -j build $(ACT_FLAGS) $(_ACT_SECRET_FLAG) --matrix node-version:$(ACT_NODE)

ci-release-build:
	gh act push -W $(RELEASE_WF) -j build $(ACT_FLAGS) $(_ACT_SECRET_FLAG)

ci-release-dryrun:
	gh act push -n -W $(RELEASE_WF) -j build $(ACT_FLAGS)

ci-all: ci-lint ci-release-build

# ── Local security scans ──────────────────────────────────────────────────────
# Reports land in .security/ (gitignored). A scanner without its token is skipped.
# `make security` runs every scanner, prints the summary, and fails if any scan failed.

SECURITY_TOOLS := semgrep snyk sonar

security:
	@rc=0; rm -f .security/*.sarif .security/*.skipped .security/sonar-issues.json; \
	for t in $(SECURITY_TOOLS); do \
	  echo "── $$t"; scripts/security-scan.sh $$t || { echo "$$t: findings or scan error"; rc=1; }; \
	done; \
	node scripts/security-summary.mjs; exit $$rc

security-semgrep security-snyk security-sonar security-aikido: security-%:
	@scripts/security-scan.sh $*; rc=$$?; node scripts/security-summary.mjs; exit $$rc

security-summary:
	@node scripts/security-summary.mjs

security-clean:
	rm -rf .security
