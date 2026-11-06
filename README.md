# Vetro updates

This branch holds the signed update files that Vetro reads from **Quick settings → General → Software update**.
It contains no source code. See [Updating Vetro without reinstalling](https://github.com/andrearicci93/vetro/blob/main/app/docs/UPDATING.md).

- `update-index.json` names the newest version, its file, size and SHA-256.
- `vetro-update-<version>.json` is the bundle. Its manifest is signed (RSA-SHA256) with the maintainer's offline key; the TV refuses anything else.
