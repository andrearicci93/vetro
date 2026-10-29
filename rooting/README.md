# Optional TV integration

This area owns the privileged platform adapter, runtime payloads and integration
tests. The application package in `../app` can be built independently and contains
none of this implementation.

- `service/`: adapter, transport, authenticated root-agent protocol and staging.
- `payload/`: active runtime components used by the integration builder.
- `tools/samsung-tv-root-master/`: upstream research/source with its original Unlicense.
- `tests/`: isolated lifecycle, authentication, injection validation and detached-launch tests.
- `on-boot-probe/package*.json`: signing dependency manifests. Historical prototypes
  and device material are local-only; they are not release dependencies.

```sh
node tests/run.cjs
```

The TV runs this adapter inside the package's web service, and Tizen 4 and 5.5 run
that service on Node.js 4.4. The adapter is therefore ES5, and the test suite
parses every packaged service file for the syntax and built-ins that runtime lacks:
one destructuring pattern is a SyntaxError while loading, and the service never
listens. Where the runtime cannot prepare the agent at all —
`crypto.generateKeyPairSync` needs Node 10.12+ — `start()` records
`platformUnsupported` once and stops retrying; the dashboard, the app list and
diagnostics keep working, and the sections that need the agent report
`no-root-agent`.

Before building, install dependencies with `npm ci` in `on-boot-probe`, then set
`AUTHOR_P12`, `DIST_P12`, `AUTHOR_PW`, `DIST_PW` and optionally `OUT` using your own
certificate profile. The builder has no password fallback. Certificates are not
supplied. Signing does not establish device compatibility or on-boot entitlement.

```sh
node build.cjs
```

The builder reads `../app`, substitutes the TV adapter, adds only `payload/`, signs
and writes the integration WGT. It never modifies app sources or deploys to a TV.
Local historical SDK/tools are not needed by the builder; use official tooling
for installation. See the [project installation guide](../README.md).

The currently installed integration reacquired an authenticated UID-0 agent after
one owner-confirmed cold boot without a manual launch on 2026-10-11. Latest source
changes have not been deployed. This observation is specific to the Q80A/firmware
in the [release audit](../app/docs/RELEASE-AUDIT.md), not a universal guarantee.
