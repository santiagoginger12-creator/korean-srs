# Sync setup

GitHub sync keeps your devices in step through your **private** data repo,
`santiagoginger12-creator/ksrs-data`. Each device adds its own reviews there and reads the
others'. Your token stays on the device. It never goes into backups, exports, or this repo.

## 1. Make a token (once a year)

1. On github.com, go to **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. **Expiration:** choose a custom date 1 year out, and write the date down.
3. **Repository access:** choose **Only select repositories**, then select `ksrs-data` only.
4. **Permissions → Repository permissions → Contents: Read and write.** Leave everything else at "No access". (GitHub adds Metadata: read-only by itself.)
5. Generate the token and copy it (it starts with `github_pat_`).

Paste the token **only into the app**. Don't put it in a file, a note, a chat, or this repo.
You can use the same token on each of your devices, or make one per device.

## 2. Turn it on (each device)

1. In the app, open **Settings → Sync**. The repository is already filled in.
2. Paste the token and tap **Save token**. Enter the expiry date if you'd like a reminder 14 days ahead.
3. Tap **Test connection**. It should say "Connected to … (private). Read and write OK".
4. Tap **Turn on**.

Sync runs when the app opens, when you finish a review or lesson session, when you come back
to the tab, and when you tap **Sync now**. It never runs during a session. If something goes
wrong, a banner says what to do. Example: "Token expired or revoked — paste a new one in
Settings → Sync."

## Notes

- **Not on the claude.ai page.** That page's security policy blocks GitHub, so use Data → Backup/Merge there.
- **Replacing the token:** paste the new one and Save. **Remove token** deletes it from the device and turns sync off.
- **What's in the repo:** `ksrs/v1/manifest.json`, `ksrs/v1/devices/<id>.json`, and
  `ksrs/v1/log/<device>/<year>-W<week>.jsonl` (one event per line, append-only). Git history is
  a free off-site backup. Manual Backup/Merge still works alongside sync.
