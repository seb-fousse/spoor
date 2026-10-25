# Roadmap

Subject to change. Spoor ships in thin vertical slices: one feature working end
to end, not one layer at a time. No dates.

## Phase 1: Desktop MVP

- First entities and migrations (see [`data-spec.md`](data-spec.md)).
- **Timelines:** define timelines and categories; record, edit, and view
  intervals, including ongoing ones.
- **Observations:** define daily metrics and enter them manually.
- **Logs and things:** define log and thing types; create log entries that
  refer to things.
- **Trash:** deleted entries are restorable for seven days, then purged.
- **Full export and import** with a tested round-trip.
- A query layer validated over Tauri IPC.

## Phase 2: Encryption at rest

- Encrypt the SQLite file (SQLCipher) behind the `Database` seam.
- Key handling via the `SecretStore` seam and the OS keychain.
- Clear UX around "no passphrase recovery".

## Phase 3: Mobile

- Choose the framework (Expo/React Native or Tauri mobile). The main pull
  toward React Native is **HealthKit** / **Health Connect** via the
  `HealthSource` seam, written as observations that never overwrite the user's
  own entries.
- Reuse `@spoor/core` unchanged; implement the seams for mobile in
  `apps/mobile/`.

## Phase 4: End-to-end encrypted sync

- Optional, self-hostable, zero-knowledge.
- Likely an encrypted append-only operation log with per-record
  last-write-wins, served from `apps/sync-server/`.

## Later, unscheduled

- **Analytics export:** a per-day feature table for offline statistics and ML.
- **Templates:** ready-made definitions, such as movie tracking, that the user
  installs and then edits like their own.
- **Plugins:** optional code that fills in data for a template, such as movie
  details from an online database. Each declares what it sends where, shown
  before installing.
- **Attachments:** images and files, such as a movie cover or a journal photo.

## Contributions

Welcome:

- Bug reports, especially **data loss or corruption**.
- Small, focused features that fit the local-first, privacy-first shape.
- Docs and test improvements.

Out of scope:

- Telemetry or analytics of any kind.
- A cloud account system, or any feature that requires a server to function.
- Social features, sharing feeds, or anything that turns personal logs into a
  network product.
- Speculative large dependencies.

The maintainer may decline features that don't fit; see
[`CONTRIBUTING.md`](../CONTRIBUTING.md).
