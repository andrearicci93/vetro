# Backups and per-application restore

Vetro 0.7.2 adds a private backup page and API. Archives are created on the TV by the root agent and downloaded by the browser; they are never uploaded anywhere.

## Web page

Open the Vetro dashboard, choose **Backups**, then choose Vetro or APL-TV. The browser downloads the resulting `.tar.gz` file to the phone or computer. The restore form accepts a filename from the Vetro backup catalog and creates a rollback archive before extracting it.

## API

- `GET /backup` lists backup files stored under `/home/owner/share/vetro-backups`.
- `POST /backup` with `{"action":"create","scope":"vetro"}` creates a Vetro archive.
- `POST /backup` with `{"action":"create","scope":"apltv"}` creates an APL-TV archive.
- `POST /backup` with `{"action":"restore","scope":"apltv","name":"...tar.gz"}` restores one application and returns the rollback filename.
- `GET /backup/download?name=...tar.gz` downloads one archive.

Application scopes use a fixed allowlist for known apps and accept a validated package identifier for separately installed clones such as `APLTVTst01`. Archive names and extraction members are validated before any write. Cache, temporary and log files are excluded. Restore applies the TV owner UID/GID (`5001:100`) and leaves a rollback archive on the TV.

## Validation performed

- 143 Vetro test suites passed on the Raspberry Pi.
- A signed 0.7.2 WGT was installed on a Samsung QE65S85FAEXXN running Tizen 10 / T-PTMFDEUC-2103.1.
- A real APL-TV archive was created from the TV and downloaded through the web endpoint.
- A real restore was performed against the separate `APLTVTst01` clone; the original `APLTVMedia` remained separate and both data roots were verified as `5001:100`.
- The TV root agent remained connected with `uid=0` after installation and restore.

Backups can contain personal settings and application data. Do not publish them or include signing certificates in a source repository.
