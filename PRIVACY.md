# Privacy

Privacy in Spoor is a property of the architecture. If anything here stops
being true, it is a bug; please report it.

## Summary

- Spoor runs fully on your device. There is no account and no Spoor server.
- No data leaves your device: no telemetry, analytics, or crash reporting.
- Your data is a single file you control, in a documented, exportable format.

## What leaves your device

**Nothing.** Spoor makes no network requests with your data and has no sync or
cloud backup. The only network access is downloading dependencies (pnpm,
Cargo) during development.

## How the code enforces this

- [`@spoor/core`](packages/core), which holds all business logic, has no
  networking dependency.
- Platform access is confined to three interfaces: `Database`, `SecretStore`,
  and `HealthSource`. None is a network client.
- No analytics or telemetry dependency exists in the tree; CI and review keep
  it that way.

## Exports

Spoor can export a full JSON/CSV copy of your data and a per-day analytics
table (see [`docs/data-spec.md`](docs/data-spec.md)). Exports run only when you
ask, go where you choose, and are **not encrypted**, even once the database
is. Treat an export as sensitive as its contents.

## Deleting your data

A deleted entry stays in the trash for seven days. After that, or when you
empty the trash, its content is erased and overwritten on disk; only a marker
recording that it existed remains.

A deletion cannot reach:

- **Exports already written.** Delete those files yourself.
- **Names of deleted definitions.** Deleting a log type, timeline, or metric
  erases its entries, but its name and settings stay in the file, hidden, so
  nothing that referred to it breaks.

## People and places

Spoor has no built-in notion of people or places; you choose whether to track
them, for example with a People timeline or Person and Place entries. Spoor
treats who you were with and where you were as the most sensitive data in the
file. It records no coordinates; if it ever does, their precision will be a
deliberate, documented choice. If sync is added, this data gets the same
end-to-end encryption as everything else.

## Health data

Daily values such as steps or mood are entered manually. On mobile, Spoor may
later read step counts from HealthKit or Health Connect through the
`HealthSource` seam. If so, it will be opt-in and read-only, the data stays on
the device, and the permissions and data read will be documented here.

## If sync is ever added

Sync is not built or promised. If added, it must be:

- **End-to-end encrypted.** The server stores only ciphertext.
- **Self-hostable and open source.**
- **Previewable.** You see exactly what would be sent before enabling it.
