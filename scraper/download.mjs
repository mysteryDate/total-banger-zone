import 'dotenv/config';
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getTrackInfo } from './spotify.mjs';

const execFile = promisify(execFileCb);

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRACKS_PATH = resolve(__dirname, '..', 'tracks.json');
const TMP_DIR = resolve(__dirname, '..', 'tmp-audio');

const AUDIO_BASE_URL = process.env.AUDIO_BASE_URL; // e.g. https://audio.totalbangerzone.com
const R2_BUCKET = process.env.R2_BUCKET || 'tbz-audio';
const DOWNLOAD_DELAY_MS = 4000;
const AUDIO_QUALITY = '192k';

function createR2Client() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('Missing R2 credentials in environment (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)');
  }

  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

/** Convert bandcamp ID (artist/track) to a safe filename */
function safeFilename(type, id) {
  return `${type}/${id.replace(/\//g, '-')}.mp3`;
}

function originalUrl(track) {
  if (track.originalUrl) return track.originalUrl;
  if (track.type === 'youtube') return `https://www.youtube.com/watch?v=${track.id}`;
  if (track.type === 'spotify') return `https://open.spotify.com/track/${track.id}`;
  if (track.type === 'bandcamp') {
    const [artist, slug] = track.id.split('/');
    return `https://${artist}.bandcamp.com/track/${slug}`;
  }
  return null;
}

async function downloadYouTube(track, outputPath) {
  const url = originalUrl(track);
  await execFile('yt-dlp', [
    '-x',
    '--audio-format', 'mp3',
    '--audio-quality', AUDIO_QUALITY,
    '-o', outputPath,
    '--no-playlist',
    '--no-warnings',
    url,
  ], { timeout: 120_000 });
}

async function downloadSpotify(track, outputPath) {
  // Look up Spotify track metadata to build a YouTube Music search query.
  // Using Spotify API → YouTube Music directly, instead of spotdl
  // (spotdl 4.4.3 has a KeyError: 'genres' bug from a Spotify API change).
  const { title, artist } = await getTrackInfo(track.id);
  const searchQuery = `ytsearch1:${artist} ${title}`;
  await execFile('yt-dlp', [
    '-x',
    '--audio-format', 'mp3',
    '--audio-quality', AUDIO_QUALITY,
    '-o', outputPath,
    '--no-playlist',
    '--no-warnings',
    '--default-search', 'ytsearch',
    searchQuery,
  ], { timeout: 120_000 });
}

async function downloadBandcamp(track, outputPath) {
  const url = originalUrl(track);
  await execFile('yt-dlp', [
    '-x',
    '--audio-format', 'mp3',
    '--audio-quality', AUDIO_QUALITY,
    '-o', outputPath,
    '--no-warnings',
    url,
  ], { timeout: 120_000 });
}

async function uploadToR2(client, filePath, r2Key) {
  const fileData = await readFile(filePath);
  await client.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: r2Key,
    Body: fileData,
    ContentType: 'audio/mpeg',
  }));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function shouldDownload(track) {
  if (track.audioUrl) return false;
  if (track.skip) return false;
  // Skip albums and playlists — they need manual resolution first
  if (track.subtype === 'album' || track.subtype === 'playlist') return false;
  // Skip tracks that previously failed (use --retry flag to retry)
  if (track.downloadError && !process.argv.includes('--retry')) return false;
  return true;
}

async function main() {
  if (!AUDIO_BASE_URL) {
    console.error('Missing AUDIO_BASE_URL in environment (e.g. https://audio.totalbangerzone.com)');
    process.exit(1);
  }

  const r2 = createR2Client();
  await mkdir(TMP_DIR, { recursive: true });

  const tracks = JSON.parse(await readFile(TRACKS_PATH, 'utf-8'));
  const pending = tracks.filter(shouldDownload);

  if (pending.length === 0) {
    console.log('No tracks need downloading.');
    return;
  }

  console.log(`${pending.length} tracks to download\n`);

  let downloaded = 0;
  let failed = 0;

  for (const track of pending) {
    const r2Key = safeFilename(track.type, track.id);
    const tmpPath = resolve(TMP_DIR, r2Key.replace(/\//g, '_'));

    console.log(`[${downloaded + failed + 1}/${pending.length}] ${track.type}: ${track.title || track.id}`);

    try {
      // Download based on source type
      if (track.type === 'youtube') {
        await downloadYouTube(track, tmpPath);
      } else if (track.type === 'spotify') {
        await downloadSpotify(track, tmpPath);
      } else if (track.type === 'bandcamp') {
        await downloadBandcamp(track, tmpPath);
      } else {
        console.warn(`  Skipping unknown type: ${track.type}`);
        continue;
      }

      // Upload to R2
      await uploadToR2(r2, tmpPath, r2Key);

      // Update track
      track.audioUrl = `${AUDIO_BASE_URL}/${r2Key}`;
      delete track.downloadError;
      downloaded++;
      console.log(`  -> uploaded to ${r2Key}`);

      // Persist progress incrementally so Ctrl+C doesn't lose work
      await writeFile(TRACKS_PATH, JSON.stringify(tracks, null, 2) + '\n');

      // Clean up temp file
      await unlink(tmpPath).catch(() => {});
    } catch (err) {
      const errorMsg = err.stderr || err.message || String(err);
      track.downloadError = errorMsg.slice(0, 500);
      failed++;
      console.error(`  FAILED: ${errorMsg.slice(0, 200)}`);

      // Persist failure state too, so next run knows not to retry (unless --retry)
      await writeFile(TRACKS_PATH, JSON.stringify(tracks, null, 2) + '\n');

      // Clean up temp file on failure too
      await unlink(tmpPath).catch(() => {});
    }

    // Rate limit between downloads
    if (downloaded + failed < pending.length) {
      await sleep(DOWNLOAD_DELAY_MS);
    }
  }

  // Write updated tracks.json
  await writeFile(TRACKS_PATH, JSON.stringify(tracks, null, 2) + '\n');

  console.log(`\nDone: ${downloaded} downloaded, ${failed} failed`);
  if (failed > 0) {
    console.log('Re-run with --retry to retry failed tracks');
  }
}

main().catch((err) => {
  console.error('Download failed:', err);
  process.exit(1);
});
