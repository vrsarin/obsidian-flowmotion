# Contributing to FlowMotion

Bug reports and ideas are welcome. Open an issue on GitHub first for larger changes, so we can agree on the approach before you write code.

## Set up

You need [Node.js](https://nodejs.org) (LTS). Then run:

```bash
npm install
npm run build
```

## Check your change

Run these before you open a pull request:

```bash
npm run lint
npm run typecheck
npm test
```

CI runs the same checks on every push and pull request. It also runs them on Node 20, 22 and 24.

## Pull requests

- Keep each pull request focused on one change.
- Add or update tests for behavior you change.
- If you change what users see, add a line to `CHANGELOG.md` under the next version.
- Do not change `manifest.json` or `versions.json` for an ordinary change. The maintainer sets versions when cutting a release.

## License

By contributing, you agree that your contribution is licensed under the same license as the project. See [LICENSE](LICENSE).
