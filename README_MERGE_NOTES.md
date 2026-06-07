# Starforge Discord Bot merge-ready notes

## What was fixed from the uploaded repo

- Removed the old `discord` dependency.
- Moved secrets out of source files and into `.env`.
- Stopped loading non-event modules as Discord events.
- Stopped loading utility modules as event listeners.
- Removed the second Discord client that was being created in `webListener.js`.
- Centralized database access and bot-channel logging.
- Kept `check.php` / website-side account workflows separate from the bot.
- Ported the newer Ent Bot runtime into the merged bot:
  - multi-entertainer support via `ENT_BOT_ENTERTAINERS`
  - custom performance command arrays and startup command sequences
  - packet-based pet/control-device discovery
  - pet auto-call and post-summon auto-group support
  - better control-device labels from STF names and payload hints

## Ent Bot config surface

The merged repo's `.env.example` now includes the newer Ent Bot settings:

- `ENT_BOT_PERFORMANCE_TYPE`
- `ENT_BOT_PERFORMANCE_COMMAND`
- `ENT_BOT_PERFORMANCE_COMMANDS`
- `ENT_BOT_STARTUP_COMMANDS`
- `ENT_BOT_INVITE_CLEANUP_COMMANDS`
- `ENT_BOT_PET_AUTO_CALL_ENABLED`
- `ENT_BOT_PET_AUTO_GROUP_ENABLED`
- `ENT_BOT_PET_AUTO_GROUP_COMMAND`
- `ENT_BOT_PET_DISCOVERY_ENABLED`
- `ENT_BOT_PET_DISCOVERY_DEBUG`
- `ENT_BOT_PET_CONTROL_DEVICE_IDS`
- `ENT_BOT_PET_CALL_RADIAL_ID`
- `ENT_BOT_PET_CALL_PAUSE_MS`
- `ENT_BOT_PET_AUTO_GROUP_DELAY_MS`
- `ENT_BOT_STARTUP_COMMAND_PAUSE_MS`
- `ENT_BOT_INVITE_CLEANUP_PAUSE_MS`
- `ENT_BOT_STARTUP_DELAY_MS`
- `ENT_BOT_AUTO_ACCEPT_GROUP_INVITES`
- `ENT_BOT_GROUP_INVITE_ACCEPT_COMMAND`
- `ENT_BOT_GROUP_INVITE_RESPONSE_PAUSE_MS`
- `ENT_BOT_AUTO_RESTART_AFTER_RECONNECT_ATTEMPTS`
- `ENT_BOT_ENTERTAINERS` JSON example block

## Immediate security action

The uploaded repo included a live-looking Discord bot token and database password in tracked files.
Rotate both before deploying any version of this bot.

## Suggested merge order

1. Replace your bootstrap with `discord-bot.js`, `config.js`, `.env.example`, and `package.json`.
2. Copy `services/`, `utils/`, `events/`, and `commands/` into your bot.
3. Create a `.env` from `.env.example`.
4. Run `npm install`.
5. Start with `npm start`.
