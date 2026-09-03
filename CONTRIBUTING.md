# Contributing

The source is public so you can read it, learn from it, and fork it under the
terms of the [MIT license](LICENSE). Development itself is closed: **pull
requests are not accepted**, and all commits land through the maintainer.

If you hit a bug or have an idea, open an issue — that is the useful path.
If you want to build on this, fork it; you do not need permission.

## Running it yourself

A fork cannot build against this project's EAS account. Point it at your own:

```bash
npm ci
npx eas init          # replaces expo.extra.eas.projectId in app.json
npx eas build --profile preview --platform ios
```

You will also want your own `expo.ios.bundleIdentifier` and
`expo.android.package` in [app.json](app.json), since the ones committed here
belong to the published app.

## Release pipeline (maintainer)

Three workflows, in ascending order of trust:

| Workflow | Trigger | Environment |
| --- | --- | --- |
| [`ci.yml`](.github/workflows/ci.yml) | every PR and push to `main` | none — holds no secrets |
| [`eas-deploy.yml`](.github/workflows/eas-deploy.yml) | manual, and pushes to `main` | named for the target channel |
| [`release.yml`](.github/workflows/release.yml) | `v*` tags, or manual | `production` |

`eas-deploy.yml` publishes an OTA update to a channel and only runs a native
build when the platform's Expo fingerprint has no finished build on that channel
yet. `release.yml` builds production binaries and submits them to App Store
Connect and Google Play.

### Credentials

GitHub holds exactly one secret, `EXPO_TOKEN`. Everything that signs or submits
lives on EAS, so a compromised repository cannot reach the stores:

```bash
npx eas credentials             # iOS cert + provisioning profile, Android keystore
npx eas credentials -p ios      # add the App Store Connect API key here
npx eas credentials -p android  # add the Google Play service account JSON here
```

Build-time configuration belongs in EAS environment variables (marked
`secret` where appropriate), not in this repository.

### Repository settings this assumes

- A `production` environment with **required reviewers**, so every store
  submission waits for a human.
- Branch protection on `main`.
- Fork pull requests do not run workflows automatically.
