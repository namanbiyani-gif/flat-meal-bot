# Flat Meal Bot

A configurable WhatsApp meal-planning bot for shared homes.

It posts the next day's plan, lets household members change meals inside WhatsApp, calculates aggregate cooking quantities, and sends final text and optional voice instructions to a cook group.

## What it does

- Assumes configured defaults when nobody replies.
- Posts a daily menu and review summary at configurable times.
- Supports personal opt-outs, leftovers, quantity changes, guests, vacations, menu changes, and cook notes.
- Uses confirmation for household-impacting changes.
- Stores an audited change history with undo references.
- Locks an immutable daily snapshot before cook delivery.
- Retries text and voice independently without resending successful deliveries.
- Replaces outdated cook text and voice after a late change.
- Keeps configuration, WhatsApp authentication, databases, logs, and audio local and ignored by Git.

## Requirements

- Node.js 22.5 or newer.
- A computer that can stay logged in, awake, and online at the scheduled times.
- A WhatsApp account that can link another device.
- macOS plus `ffmpeg` only when voice notes are enabled.

This project uses a linked-device WhatsApp library rather than the official Business API. Review that trade-off before using it with an important account.

## Setup

```bash
git clone https://github.com/namanbiyani-gif/flat-meal-bot.git
cd flat-meal-bot
npm install
npm run setup
npm run setup:whatsapp
npm run doctor
npm start
```

`npm run setup` asks for:

- household and cook terminology,
- timezone and schedule,
- members and administrators,
- lunch and dinner defaults,
- custom recurring items such as protein, eggs, salad, or milk,
- guest defaults,
- a seven-day menu,
- optional macOS voice settings.

`npm run setup:whatsapp` displays a QR code, saves the linked-device session under `auth/`, lists your WhatsApp groups, and lets you select the operations and cook groups. It does not send a test message.

## First-time member linking

The first time an unknown person messages the operations group, the bot replies with the configured member list. That person links their account with:

```text
link 1
```

Each configured member should link once. An already-linked member cannot be claimed by another account.

## WhatsApp usage

Send:

```text
change
```

to open the numbered guided menu. Common shortcuts also work:

```text
no lunch
dinner leftovers
lunch 3 rotis
dinner dish 0.5
lunch item personal-protein 150
guest lunch 2
vacation 2026-08-01 to 2026-08-05
menu dinner: Chickpeas | rice
cook note dinner: less spicy
confirm ABCD1234
undo ABCD1234
```

Permanent personal defaults can be changed with:

```text
default lunch carb 3
default dinner dish 0.5
default lunch item personal-protein 150
```

Administrators can change the regular weekly menu through option 6 in the guided flow.

## Daily workflow

The example schedule is:

- 22:00 — menu announcement,
- 22:30 — review summary,
- 22:40 — silent plan lock,
- 22:45 — final cook text and optional voice note.

A late change after lock creates a replacement snapshot. The bot posts an operations update, attempts to delete the old cook text and voice independently, and sends fresh normal cook instructions from the new snapshot.

## Useful commands

```bash
npm run preview                    # Preview using local config, or the example config
npm run preview -- 2026-08-03     # Preview a specific service date
npm run db:init                    # Initialize the local database explicitly
npm run doctor                     # Check config, WhatsApp auth, and voice dependencies
npm test                           # Run the test suite
```

On macOS, install the optional background service with:

```bash
bash scripts/install-launch-agent.sh
```

The Mac must remain logged in, awake, online, and normally have its lid open when scheduled jobs run.

## Local files and privacy

Never commit these paths:

- `.env`
- `config/household.json`
- `auth/`
- `data/`
- `logs/`
- `audio/`

They are included in `.gitignore`. The repository contains fictional example members and group placeholders only.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## License

MIT
