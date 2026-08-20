# CI/CD and Android releases

The repository contains two GitHub Actions workflows:

- `CI` runs the test suite and builds the web bundle on pushes and pull
  requests targeting `main`.
- `Android Release` builds, signs, verifies, and publishes an APK when a stable
  semantic version tag such as `v1.1.0` is pushed. It can also be started from
  the Actions tab with a version input; in that case it creates the matching
  tag and release from the selected commit.

## Configure production signing

Create and securely back up one Android release keystore. Losing it prevents
future updates from being installed over releases signed with that key.

```powershell
keytool -genkeypair -v -keystore klarwert-release.jks -alias klarwert -keyalg RSA -keysize 4096 -validity 10000
```

In GitHub, open **Settings > Secrets and variables > Actions** and create these
repository secrets:

- `ANDROID_KEYSTORE_BASE64`: the entire keystore encoded as one Base64 string.
- `ANDROID_KEYSTORE_PASSWORD`: the keystore password.
- `ANDROID_KEY_ALIAS`: the alias passed to `keytool`.
- `ANDROID_KEY_PASSWORD`: the private key password.

On Windows, copy the Base64 value with:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("klarwert-release.jks")) | Set-Clipboard
```

Never commit the `.jks` file or any of its passwords.

If repository or organization policy restricts `GITHUB_TOKEN`, allow GitHub
Actions to create releases under **Settings > Actions > General > Workflow
permissions**. The release workflow itself requests only `contents: write`;
the regular CI workflow remains read-only.

## Publish a release

Either run **Android Release** from the GitHub Actions tab and enter a version,
or create and push a tag:

```bash
git tag v1.1.0
git push origin v1.1.0
```

The workflow validates the version, runs all tests, generates the ignored
Capacitor Android project, applies the version to the Android manifest, builds
the release APK, signs it with the configured keystore, verifies the signature,
and uploads both the APK and its SHA-256 checksum to GitHub Releases.

For merge protection, add a branch protection rule for `main` and require the
`test-and-build` status check. This ensures pull requests cannot merge while
tests or the web build are failing.
