# Flat Meal Bot

A WhatsApp meal-planning bot for shared homes.

It posts tomorrow's menu, assumes everyone's normal meal quantities unless someone asks for a change, calculates total cooking quantities, and sends final instructions to the cook.

No coding knowledge is required for normal installation and use. You will need to copy and paste a few commands into Terminal.

> [!IMPORTANT]
> Flat Meal Bot uses WhatsApp's linked-device system through Baileys. It is not the official WhatsApp Business API. Test it in disposable WhatsApp groups before using real household groups.

## What it does

- Posts tomorrow's lunch and dinner menu
- Uses each person's normal quantities automatically
- Accepts meal changes inside WhatsApp
- Handles guests, vacations, leftovers, and quantity changes
- Totals rotis, rice, parathas, shared dishes, and custom items
- Sends the cook a final text message
- Can also send a macOS-generated voice note
- Replaces outdated cook instructions after a late change
- Keeps configuration and WhatsApp login data on your own computer

## Before you start

You need:

1. A Mac that can stay awake and online around the scheduled meal-planning time
2. A WhatsApp account that can link another device
3. Two test WhatsApp groups:
   - one for household members
   - one for cook instructions
   The same test group can be used for both.
4. Node.js version 22 or newer

### Install Node.js

Go to the official Node.js download page:

https://nodejs.org/en/download

Download and run the macOS installer for an LTS version.

After installation:

1. Open **Terminal** using Spotlight search
2. Paste:

```bash
node --version
```

You should see a version beginning with `v22`, `v24`, or newer.

## Easy macOS installation

### Step 1: Download the bot

On this GitHub page:

1. Click the green **Code** button
2. Click **Download ZIP**
3. Open the downloaded ZIP
4. Move the extracted folder into **Documents**
5. Rename the folder to:

```text
flat-meal-bot
```

Your folder should now be:

```text
Documents/flat-meal-bot
```

### Step 2: Open Terminal in the bot folder

Open Terminal and paste:

```bash
cd ~/Documents/flat-meal-bot
```

Then install the required packages:

```bash
npm install
```

Wait until the command finishes and the Terminal prompt returns.

### Step 3: Configure your household

Run:

```bash
npm run setup
```

The setup wizard will ask simple questions about:

- household name
- how the cook should be addressed
- timezone
- daily schedule
- household members
- each person's normal meal quantities
- guests
- weekly menu
- optional voice notes

Press **Enter** to accept a suggested value shown inside square brackets.

Your answers are saved only on your computer in:

```text
config/household.json
```

That private file is not part of the public GitHub repository.

### Step 4: Connect WhatsApp

Run:

```bash
npm run setup:whatsapp
```

A QR code will appear in Terminal.

On your phone:

1. Open WhatsApp
2. Open **Settings**
3. Tap **Linked Devices**
4. Tap **Link a Device**
5. Scan the QR code shown in Terminal

The bot will then list your WhatsApp groups.

Enter the number beside the household test group, then choose the cook test group. No WhatsApp message is sent during setup.

### Step 5: Check the installation

Run:

```bash
npm run doctor
```

A successful check should show that configuration, WhatsApp authentication, and group destinations are valid.

### Step 6: Preview the plan

Run:

```bash
npm run preview
```

This prints tomorrow's household summary and cook instructions in Terminal without sending anything.

Review the quantities carefully.

### Step 7: Start a safe test

Start the bot:

```bash
npm start
```

Keep Terminal open.

In the household test group, send:

```text
change
```

The bot should reply with a numbered menu.

To stop the bot, return to Terminal and press:

```text
Control + C
```

Do not select real household groups until this test works correctly.

## WhatsApp setup for household members

The first time a household member messages the bot, it asks them to link their WhatsApp account to a configured member.

They reply with a number such as:

```text
link 1
```

Each person only needs to do this once.

## Making changes in WhatsApp

Nobody needs to reply when the default plan is correct.

To make a change, send either:

```text
change
```

or:

```text
menu
```

The bot replies with numbered categories:

```text
1. My meals tomorrow
2. Guests tomorrow
3. Tomorrow's shared menu
4. I'll be away for some dates
5. My usual meal defaults
6. Weekly household menu
7. Review or undo a change
```

Category 6 is shown only to household administrators.

Reply with the number of the category you need. The bot will then show the exact format for the next reply.

Send `0` or `cancel` at any point to leave the guided flow.

### 1. My meals tomorrow

Choose category `1`, then reply with a personal meal change such as:

```text
lunch skip
dinner leftovers
lunch carb 3
dinner dish 0.5
lunch item personal-protein 150
lunch include
```

### 2. Guests tomorrow

Choose category `2`, then reply with the meal and number of guests:

```text
lunch 2
```

Guest changes affect household cooking totals and may require confirmation.

### 3. Tomorrow's shared menu

Choose category `3`, then reply in this format:

```text
dinner: Chickpeas | rice
```

A shared-menu change affects the household and requires confirmation.

### 4. I'll be away for some dates

Choose category `4`, then enter the date range:

```text
2026-08-01 to 2026-08-05
```

This opts you out of both lunch and dinner for those dates.

### 5. My usual meal defaults

Choose category `5`, then enter a permanent personal default such as:

```text
lunch carb 3
dinner dish 0.5
lunch item personal-protein 150
```

These defaults are used on future days unless you make a one-day change.

### 6. Weekly household menu

This category is available only to administrators.

Choose category `6`, then enter a permanent weekly-menu change:

```text
Monday lunch: Mixed vegetables | roti
```

The bot shows the proposed change and asks you to reply:

```text
1
```

to confirm, or:

```text
2
```

to cancel.

### 7. Review or undo a change

Choose category `7` to see recent change references and their status.

Undo an active change with:

```text
undo ABCD1234
```

### Confirmation references

When a household-wide change needs confirmation, the bot returns a reference.

Confirm it with:

```text
confirm ABCD1234
```

Cancel it with:

```text
cancel ABCD1234
```

### Optional direct shortcuts

Experienced users can skip the numbered menu and send supported shortcuts directly:

```text
no lunch
no dinner
dinner leftovers
lunch 3 rotis
dinner dish 0.5
guest lunch 2
vacation 2026-08-01 to 2026-08-05
```

The numbered `change` flow is the recommended option because it shows the expected format at each step.

## Default daily schedule

The sample configuration uses:

| Time | Action |
|---|---|
| 10:00 PM | Post tomorrow's menu |
| 10:30 PM | Post the review summary |
| 10:40 PM | Lock the final plan silently |
| 10:45 PM | Send cook instructions |

The setup wizard lets you change these times.

## Run automatically every day on macOS

Only do this after manual testing works correctly.

From the bot folder, run:

```bash
bash scripts/install-launch-agent.sh
```

This starts the bot automatically for your macOS user account.

The Mac must remain:

- logged in
- awake
- online

Closing a MacBook lid usually puts it to sleep, so scheduled WhatsApp messages may not run.

## Updating later

Open Terminal and go to the folder:

```bash
cd ~/Documents/flat-meal-bot
```

When the project publishes an update, ZIP-based installations are easiest to update by downloading a fresh ZIP and repeating setup carefully. Back up these private folders first:

```text
config/
auth/
data/
```

Git users can instead run:

```bash
git pull
npm install
npm run doctor
```

## Troubleshooting

### `node: command not found`

Node.js is not installed correctly. Install it from:

https://nodejs.org/en/download

Then close and reopen Terminal.

### `npm: command not found`

Reinstall Node.js, then reopen Terminal.

### WhatsApp QR code does not appear

Run:

```bash
rm -rf auth
npm run setup:whatsapp
```

This removes only the bot's local linked-device session. It does not delete phone chats.

### WhatsApp disconnected

On your phone, open **WhatsApp → Settings → Linked Devices** and check whether the bot's linked device still exists.

Pair again with:

```bash
npm run setup:whatsapp
```

### Messages are not sent at the scheduled time

Check that:

- the Mac is awake
- the Mac is online
- the user account is logged in
- the bot is running
- the selected WhatsApp groups still exist

Run:

```bash
npm run doctor
```

### Voice notes do not work

Voice notes are optional and currently require macOS plus `ffmpeg`.

Text instructions continue to work without voice notes.

## Important private files

Never upload or share these:

```text
.env
config/household.json
auth/
data/
logs/
audio/
```

They may contain household settings, WhatsApp authentication, database records, or generated audio.

## Useful commands

| Command | What it does |
|---|---|
| `npm run setup` | Configure the household |
| `npm run setup:whatsapp` | Link WhatsApp and choose groups |
| `npm run doctor` | Check whether setup is valid |
| `npm run preview` | Show the plan without sending |
| `npm start` | Start the bot |
| `npm test` | Run automated tests |
| `npm run test:privacy` | Check the repository for private data |

## Technical notes

Flat Meal Bot uses:

- Node.js
- Baileys for WhatsApp linked-device transport
- SQLite for local state
- immutable daily snapshots
- idempotent scheduled jobs
- independent delivery retries

One installation manages one household.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the technical design.

## Limitations

- The computer must stay running and online.
- WhatsApp or Baileys changes can affect linked-device behavior.
- Voice generation is currently macOS-only.
- This is a deterministic workflow bot, not a general-purpose AI assistant.
- There is no hosted cloud service included.

## Security

Read [SECURITY.md](SECURITY.md) before sharing logs or reporting a vulnerability.

## License

MIT
