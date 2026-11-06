# Vetro

<!-- impeccable:product-schema 1 -->

## Platform

web

The management dashboard runs in a phone or computer browser on the TV's local network. A bundled native C#/EFL launcher runs on the Samsung Tizen TV; it is a distinct companion surface, not an iOS or Android app.

## Users

Samsung TV owners who can install Vetro on a rooted TV, then use a phone or computer on their home network to reduce tracking and background services, customize the remote, and replace Samsung Home. Installation capability does not imply familiarity with firmware packages or system services: everyday controls should be understandable without that knowledge.

## Product Purpose

Give owners understandable control over their TV's privacy, background resource use, Home launcher, and remote shortcuts. Success means owners can understand a change, see what actually happened on their device, and reverse supported changes.

The confirmed priority is simple, understandable control with reversible changes.

## Positioning

Vetro combines a launcher, debloater, and remapper with a TV-hosted management dashboard. Supported privileged operations run on the TV through the integration adapter and root agent, so a computer does not need to remain connected. MQTT connects TV state and remote actions to Home Assistant.

## Operating Context

- Install on a supported rooted Samsung Tizen TV, open Vetro once, and complete the documented Developer Mode setup. Startup can take up to 90 seconds.
- Pair a browser or script using the six-digit code shown on the TV. The dashboard and API are for paired devices on a trusted LAN; traffic uses plain HTTP and must not be exposed to the Internet.
- Use Quick settings for common changes, Task manager to inspect individual components, Launcher to configure the replacement Home bar, and Remapper for remote shortcuts. Advanced workflows include TV settings, resource monitoring, domain blocking, diagnostics, plugins, and MQTT.
- The native launcher uses the TV remote. Samsung Home remains reachable from the launcher.
- For local dashboard development, run `npm start` from `app/` and open `http://127.0.0.1:8099/`. Local mode exposes unavailable-device states; it does not simulate a connected TV.

## Capabilities and Constraints

- Disabling keeps a component installed and can be reversed. Stopping ends a running process. Uninstalling requires an installer to recover. Preserve those distinctions and the existing confirmations and protected-component restrictions.
- Quick settings and Task manager share an inventory. A switch describes the benefit, and on means that benefit is applied. Report actual outcomes, including partial completion and unavailable or unknown states.
- Restore the TV reports and reverses supported Vetro changes. Removing Vetro is a separate maintenance workflow.
- The launcher is optional. It reads the apps, order, and icons from Samsung Home; the native launcher and dashboard have separate implementations and visual authorities.
- Device operations depend on the optional TV integration adapter and supported firmware privileges. An app-only build is not a working device integration.
- Compatibility varies by model, firmware, and runtime. The Q80A is the development and test device; distinguish it from community-reported results. Refer to `README.md` for the maintained compatibility record rather than promising a universal range.
- Older Tizen runtimes can serve parts of the dashboard without supporting the root agent. Show capability limits instead of presenting unsupported actions as available.
- Domain filtering does not guarantee removal of every app's ads or telemetry. Resource measurements are device-specific evidence, not general guarantees.
- Third-party Vetro Shards plugins are not sandboxed and can exercise Vetro's privileges. Keep their documented trust implications visible when installing or enabling them.
- Dashboard updates are signed, include the native launcher, and support automatic rollback if startup fails.

## Brand Commitments

The product name is Vetro; the plugin system is Vetro Shards. Preserve the existing app icon at `app/icon.png`. Interface copy is English, short, and describes what changes on the TV. Preserve factual labels and mark unfinished features as beta.

Existing visual guidance is recorded in `app/design-system/DESIGN.md`; the launcher's chosen design is recorded separately in `dock/designer/chosen.json`. This product record does not replace those authorities.

## Evidence on Hand

- `README.md`: product overview, compatibility reports, installation entry points, and attribution.
- `app/docs/images/`: existing dashboard and TV launcher captures; these document captured states rather than guaranteeing current rendering.
- `app/docs/PERFORMANCE.md`: device measurements and their methodology and limitations.
- `app/docs/INSTALLATION.md`, `app/docs/SIGN-IN.md`, and `SECURITY.md`: installation, pairing, and network constraints.
- `app/docs/RELEASE-AUDIT.md`: validation record and outstanding checks.
- `app/docs/DIAGNOSTIC-EXPORT.md`: redacted diagnostic report contract.
- `app/docs/plugins.md` and `app/docs/mqtt/README.md`: plugin and Home Assistant workflows.

Do not invent compatibility confirmations, performance benchmarks, testimonials, or verification results. Keep claims tied to the documented device and test conditions.

## Product Principles

1. Make everyday control understandable before adding advanced options.
2. Prefer reversible changes and explain the consequence before actions that require recovery.
3. Show the actual device result, including partial completion, failure, and uncertainty.
4. Keep the owner's route back to Samsung Home and supported restoration workflows reachable.
5. Match claims and available controls to observed device capabilities and evidence.

## Open Decisions

No additional product-specific accessibility standard or localization expansion was established during init. Existing accessibility behavior remains part of the implementation to preserve; this record does not assert conformance.
