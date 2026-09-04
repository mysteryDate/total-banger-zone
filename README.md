# Total Banger Zone

Music player aggregating links from a Discord channel. Live at [totalbangerzone.com](https://totalbangerzone.com).

Static HTML/CSS/JS (no build). Audio self-hosted on Cloudflare R2, played via native `<audio>`. Falls back to iframe embeds for tracks not yet downloaded.

## Local dev

```sh
npx serve
```

Opens at `localhost:3000`. Edits are live on reload.

## Scraper / downloader

See [scraper/](scraper/) — scrapes Discord for music links, downloads audio via `yt-dlp`, uploads to R2.

- `npm run scrape` — fetch new Discord posts (runs in GitHub Actions every 15min)
- `npm run download` — download audio for tracks missing `audioUrl`. Add `--retry` to retry previously failed tracks
- `npm run remove -- <type>:<id>` — pull a track: deletes its R2 audio, drops it from `tracks.json`, and adds the key to `scraper/blocklist.json` so a full backfill won't re-add it

System deps: `yt-dlp` and `ffmpeg`. Downloads must run from a residential IP; YouTube 403s datacenter ranges, which is why this is not a GitHub Actions job.

Keep `yt-dlp` current. A version more than a few weeks old starts getting `HTTP Error 403` on every video.

Env vars in `scraper/.env` — see [.env.example](.env.example).

### Scheduled downloads (Windows)

```powershell
winget install OpenJS.NodeJS.LTS yt-dlp.yt-dlp
# PowerShell 7 from the zip, NOT the Store build (Store pwsh will not launch from a scheduled task):
# https://github.com/PowerShell/PowerShell/releases -> PowerShell-<ver>-win-x64.zip
#   Expand-Archive PowerShell-<ver>-win-x64.zip -DestinationPath $env:LOCALAPPDATA\Programs\PowerShell\7
cd scraper; npm ci
./register-download-task.ps1
```

Registers `TotalBangerZone-DownloadAudio`, which runs every 15min and at logon, commits and pushes `tracks.json` when it adds audio, and self-updates `yt-dlp`.

Add `-RunWhenLoggedOut` to run it logged out and without a console window. It prompts for your Windows password and stores it with the task, which is what keeps `git push` able to decrypt the GitHub token in Credential Manager. Without a password the task cannot do that and push hangs.

**Re-run it after every Windows password change.** The task keeps the old password, stops starting, and cannot log the failure because the failure happens before the script runs. The symptom is a log that simply stops. `Get-ScheduledTaskInfo -TaskName TotalBangerZone-DownloadAudio` shows `LastTaskResult` 3221684229 (0xC0070005).

- Log: `%LOCALAPPDATA%\total-banger-zone\download-cron.log`
- Run now: `Start-ScheduledTask -TaskName TotalBangerZone-DownloadAudio`
- Last result: `Get-ScheduledTaskInfo -TaskName TotalBangerZone-DownloadAudio`

`scraper/download-cron.sh` is the Linux/cron equivalent.
