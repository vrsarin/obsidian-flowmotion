# Releasing FlowMotion

Written for the maintainer. Releases are built and published by `.github/workflows/release.yml`.

## Check locally first

```sh
make ci-lint            # build, lint, and test in gh act (Node 24)
make ci-release-build   # release build in gh act, stopping before attest and publish
make release-check      # checks manifest.json, versions.json and the release files
```

Set `ACT_NODE=22.x` to test another Node version. Run `make ci-all` for both.

## Cut a release

1. Set the new version in `manifest.json`, `package.json` and `versions.json`. Add a `CHANGELOG.md` section.
2. Commit the changes and merge them to `main`.
3. Tag the commit with the version, with no `v` prefix:

   ```sh
   git tag 0.1.1
   git push origin 0.1.1
   ```

4. The workflow checks that the tag matches `manifest.json`, runs lint and tests, builds, attests, and publishes the release with `main.js`, `manifest.json`, `styles.css`, and `flowmotion-addons.zip`.
5. Open the release on GitHub and confirm the four assets are there.

Obsidian rules: the tag must equal the manifest version, and the release must be published, not a draft. Do not change an existing tag. Make a new version.

## Submit to the community catalog (first release only)

Obsidian lists plugins from `community-plugins.json` in `obsidianmd/obsidian-releases`. Submit once. Later releases are picked up from the GitHub release.

1. Run `node scripts/community-entry.mjs` and copy the JSON it prints.
2. Fork `obsidianmd/obsidian-releases`. Add the entry to the end of `community-plugins.json`.
3. Open a pull request. The Obsidian review bot checks the manifest and release. Fix anything it reports.

The pull request step is manual. Nothing in this repo opens it for you.
