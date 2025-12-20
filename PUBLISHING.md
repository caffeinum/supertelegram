# publishing guide

## setup

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
