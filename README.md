# Total Banger Zone

Music player aggregating links from a Discord channel. Live at [totalbangerzone.com](https://totalbangerzone.com).

Static HTML/CSS/JS (no build). Audio self-hosted on Cloudflare R2, played via native `<audio>`. Falls back to iframe embeds for tracks not yet downloaded.

## Local dev

```sh
npx serve
```

Opens at `localhost:3000`. Edits are live on reload.

## Scraper / downloader

See [scraper/](scraper/) — scrapes Discord for music links, downloads audio via `yt-dlp`/`spotdl`, uploads to R2.

- `npm run scrape` — fetch new Discord posts (runs in GitHub Actions every 15min)
- `npm run download` — download audio for tracks missing `audioUrl`. Add `--retry` to retry previously failed tracks
- `scraper/download-cron.sh` — wrapper for scheduled runs (exits early if nothing pending)

System deps: `yt-dlp`, `spotdl`, `ffmpeg` (install yt-dlp and spotdl via `pipx`).

Env vars in `scraper/.env` — see [.env.example](.env.example).
