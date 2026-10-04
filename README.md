# Tavern Manager

A local library for SillyTavern characters, WorldBooks, presets, themes and regex scripts.

## Features

- Characters: import and export JSON/PNG cards, edit, tag, change avatars, batch actions
- WorldBooks: edit, import and export, link to characters, batch actions
- ST Files: keep chat completion presets, UI themes and regex scripts; upload, download, or push and pull them from SillyTavern
- Sync with SillyTavern and TauriTavern through the [tavern-manager-sync](https://github.com/JL0952/tavern-manager-sync) extension
- RP stats and Library Map
- Backup export and import
- Light and dark mode, works on phones

## Install and Run

Requires Node.js 22.12 or later.

```
npm install
npm run dev
```

Open `http://localhost:5173`.

To open Manager from a phone or another computer on the same network:

```
npm run dev:lan
```

Then open `http://<computer-ip>:5173` on that device. Without `dev:lan`, only this computer can reach Manager.

Manager won't start while something else uses port `3000`, such as another Manager left running.

## Sync with SillyTavern

1. In SillyTavern or TauriTavern, open **Extensions → Install Extension** and enter `https://github.com/JL0952/tavern-manager-sync`.
2. In the extension, set the Manager endpoint and click **Save**:
   - Same computer: `http://127.0.0.1:3000/api/sync/v1`
   - Another device: `http://<computer-ip>:3000/api/sync/v1` (start Manager with `npm run dev:lan`)

3. Click **Refresh**, pick a tab, then **Push** or **Pull**.

## Data

- Everything is stored in the `data` folder on this computer and is never committed to git.
- Presets are kept as SillyTavern saves them, including any reverse proxy address and password.
- Export a backup (**Backup → Export Backup**) before large batch actions.
- With `npm run dev:lan`, any device on your network can reach Manager without a password. Use it only on networks you trust.

## Known Limitations

- A changed avatar alone does not mark a character as changed; Push or Pull that character to send the new avatar.
- For V2/V3 cards, the values under `data` win over the older top-level fields.
- A tag containing a comma can't be typed in tag fields. It is kept as long as you leave the tag text unchanged.
- A WEBP avatar that can't be converted to PNG is not sent to SillyTavern.
- The Library Map can be slow with very large libraries.

## Development

- `npm test` runs the server tests. Set `ST_SYNC_BROWSER_ROOT` to the extension folder to include the tests that check it.
- `npm run build` builds the web UI.
- Code shared with the extension lives in `server/services` (see `server/scripts/exportSyncCore.js`). After changing it, run `npm run sync-core:export -- <extension folder>`.
