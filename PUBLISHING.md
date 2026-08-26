# publishing guide

## automated (github actions) — preferred

CI publishes to npm on every version tag. one-time setup: add a repo secret
`NPM_TOKEN` (npmjs.com → Access Tokens → **Automation** token) under
Settings → Secrets and variables → Actions.

then to release:
```bash
# bump version in package.json first, commit, then:
git tag "v$(node -p "require('./package.json').version")"
git push --tags
```
the `.github/workflows/publish.yml` workflow checks the tag matches
package.json, installs, and runs `npm publish --access public --provenance`.
you can also trigger it manually from the Actions tab (workflow_dispatch).

## manual setup

1. login to npm:
```bash
npm login
```

2. authenticate with your 2fa if needed

## publish new version

1. bump version in `package.json`:
```bash
npm version patch  # or minor, major
```

2. publish to npm:
```bash
npm publish --access public
```

note: scoped packages (`@caffeinum/...`) need `--access public` flag to be free

## verify publication

```bash
npm view @caffeinum/telegram-cli
```

## test installation

```bash
npm install -g @caffeinum/telegram-cli
telegram --help
```

## troubleshooting

- **402 payment required**: add `--access public` flag
- **403 forbidden (name conflict)**: rename package or use scoped name `@username/package`
- **otp required**: add `--otp=<code>` flag with 2fa code
- **401 unauthorized**: run `npm login` again
