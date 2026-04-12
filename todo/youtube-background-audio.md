# YouTube Background Audio via Cloudflare Worker + Piped API

## Problem
YouTube iframe embeds pause when the phone is locked/backgrounded. Premium status doesn't carry into third-party embeds. Bandcamp and Spotify already work in background via native `<audio>` and the keepalive/Media Session setup.

## Approach
Use a Cloudflare Worker as a CORS proxy to the Piped API, which returns direct audio stream URLs for YouTube videos. Play via native `<audio>` element (supports background playback). Fall back to YouTube iframe if the proxy or Piped is down.

## Architecture
```
Browser <audio> ←── audio stream URL (no CORS needed for media elements)
Browser fetch() ──→ Cloudflare Worker ──→ Piped API ──→ returns audioStreams[]
                    (adds CORS headers)   (server-to-server, no CORS issue)
```

## Confidence: ~85%
- CORS proxy part: very confident
- Piped instance reliability: less confident, public instances go up/down
- Iframe fallback covers failures gracefully

## Tasks

### 1. Cloudflare Worker
- [ ] Create Cloudflare account (free tier, 100k req/day)
- [ ] Deploy a ~20-line worker that:
  - Receives `GET /streams/{videoId}`
  - Forwards to Piped API instance (try multiple, rotate on failure)
  - Returns response with `Access-Control-Allow-Origin: *`
- [ ] Note the worker URL (e.g. `https://tbz-proxy.your-name.workers.dev`)

### 2. Frontend changes — index.html
- [ ] Add `fetchYouTubeAudioUrl(videoId)` that calls the worker
- [ ] Extract existing YT iframe logic into `fallbackToYTIframe()`
- [ ] Replace YouTube branch in `playTrack()`:
  - Try native `<audio>` via worker first (shows thumbnail + audio controls)
  - On failure or timeout, fall back to iframe embed
  - Guard against race conditions (user skips while loading)
- [ ] Add `ytAudioElement` global, clean up on track change
- [ ] Update Media Session play/pause handlers for `ytAudioElement`

### 3. Service worker fix
- [ ] Make sw.js skip cross-origin requests (only handle same-origin)
