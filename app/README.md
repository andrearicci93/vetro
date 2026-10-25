# Vetro application

Feature development lives here, independently of the optional privileged integration.
See the [project README](../README.md) for features, installation, compatibility,
performance limitations, credits and support.

```sh
npm test
node service/main.js
OUT=/tmp/vetro-app-only.wgt node build.cjs
```

Local mode uses the unavailable-device platform adapter. The standalone package
has no root payloads, SDB client or signing material. Do not mistake this unsigned
package for a working device integration.

- [Platform contract](PLATFORM.md)
- [Diagnostic export schema](docs/DIAGNOSTIC-EXPORT.md)
- [Release audit and outstanding checks](docs/RELEASE-AUDIT.md)
- [Issue-analysis pipeline](docs/LOG-ANALYSIS.md)
- [Home Assistant Container / MQTT setup](docs/mqtt/README.md)
- [Performance measurements and limitations](docs/PERFORMANCE.md)
- [Startup delay test](docs/BOOT-TEST.md)

The app catalog (`service/app-facts.js`) is generated from a private firmware dump:

```sh
python3 scripts/build-app-catalog.py /path/to/dump/rootfs /tmp/app-facts-full.json --compact service/app-facts.js
```

The default management port is 8099. `VETRO_PORT=9000 node build.cjs` builds a package that uses another port (the widget and the service both get it); `VETRO_PORT` also overrides it when running `node service/main.js` locally. TV-specific
operations require the optional adapter and supported firmware/signing privileges.
