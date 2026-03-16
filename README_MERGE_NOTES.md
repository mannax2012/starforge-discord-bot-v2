# Starforge Discord Bot merge-ready notes

## What was fixed from the uploaded repo

- Removed the old `discord` dependency.
- Moved secrets out of source files and into `.env`.
- Stopped loading non-event modules as Discord events.
- Stopped loading utility modules as event listeners.
- Removed the second Discord client that was being created in `webListener.js`.
- Centralized database access and bot-channel logging.
- Kept `check.php` / website-side account workflows separate from the bot.

## Immediate security action

The uploaded repo included a live-looking Discord bot token and database password in tracked files.
Rotate both before deploying any version of this bot.

## Suggested merge order

1. Replace your bootstrap with `discord-bot.js`, `config.js`, `.env.example`, and `package.json`.
2. Copy `services/`, `utils/`, `events/`, and `commands/` into your bot.
3. Create a `.env` from `.env.example`.
4. Run `npm install`.
5. Start with `npm start`.
