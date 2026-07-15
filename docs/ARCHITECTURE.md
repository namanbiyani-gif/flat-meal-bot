# Architecture

## Configuration boundary

`config/household.json` is the local source for initial household settings. It is validated before database creation and is never committed.

The initial seed contains members, meal defaults, custom items, weekly menu, destinations, schedule, and voice settings. Runtime changes live in SQLite so restarting the process does not discard them.

## Canonical state

SQLite stores:

- household settings and member identities,
- per-meal defaults and arbitrary custom items,
- weekly menu defaults,
- deduplicated inbound messages,
- pending, active, replaced, reverted, and cancelled plan changes,
- guided-flow sessions,
- configuration audit records,
- immutable daily snapshots,
- independent delivery and deletion records,
- idempotent scheduled-run records.

## Calculation

Every member has lunch and dinner defaults for:

- shared dish portions,
- roti quantity,
- rice quantity,
- paratha quantity,
- arbitrary custom items with key, label, quantity, and unit.

The materializer selects the weekday menu, applies active dated changes, creates guests from a configured template, and passes the result to the deterministic calculator. Lunch, dinner, and full-day totals are reconciled independently.

## Change workflow

Personal changes activate immediately and receive an undo reference. Guest, shared-menu, and cook-note changes stay pending until confirmed. A newer active change with the same scope replaces the older one while retaining history.

Unknown WhatsApp senders use a one-time self-link flow. Subsequent messages are mapped by the exact local sender identity.

## Snapshots and delivery

The scheduler creates content-addressed daily snapshots. Locking supersedes the previous locked version for the date. Cook delivery is permitted only from a locked snapshot.

Text and voice deliveries have separate records and retry counters. A successful delivery is not resent when another delivery fails.

After a late change, replacement voice is generated before old cook messages are deleted. Old text and voice deletion are attempted independently, and deletion failure does not block fresh delivery.

## Transport

The Baileys transport:

- persists a multi-file linked-device session,
- reconnects with bounded exponential backoff,
- filters inbound messages to the operations group,
- sends text and OGG/Opus push-to-talk audio,
- deletes previously sent messages,
- sanitizes operational log objects.

## Voice

The optional `macos-say` provider creates an AIFF file with the macOS `say` command and converts it to OGG/Opus with `ffmpeg`. The intermediate file is deleted. Voice can be disabled without affecting text delivery.
