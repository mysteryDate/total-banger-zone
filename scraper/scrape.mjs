import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchAllMessages, fetchMemberNick } from './discord.mjs';
import { extractLinks } from './extractors.mjs';
import { fetchMetadata } from './metadata.mjs';
import { hasSpotifyCredentials, getMostPopularAlbumTrack, getMostPopularPlaylistTrack } from './spotify.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = resolve(__dirname, 'state.json');
const TRACKS_PATH = resolve(__dirname, '..', 'tracks.json');

const GUILD_ID = process.env.DISCORD_GUILD_ID;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

async function loadState() {
  try {
    const raw = await readFile(STATE_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveState(state) {
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

async function loadExistingTracks() {
  try {
    const raw = await readFile(TRACKS_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function main() {
  if (!process.env.DISCORD_BOT_TOKEN) {
    console.error('Missing DISCORD_BOT_TOKEN in environment');
    process.exit(1);
  }
  if (!GUILD_ID || !CHANNEL_ID) {
    console.error('Missing DISCORD_GUILD_ID or DISCORD_CHANNEL_ID in environment');
    process.exit(1);
  }

  console.log(`Scraping channel ${CHANNEL_ID} in guild ${GUILD_ID}...`);

  // Load state and existing tracks
  const state = await loadState();
  const existingTracks = await loadExistingTracks();
  const existingKeys = new Set(existingTracks.map((t) => `${t.type}:${t.id}`));

  console.log(`Existing tracks: ${existingTracks.length}`);
  console.log(`Last message ID: ${state.lastMessageId || '(none — full backfill)'}`);

  // Fetch messages from Discord
  const messages = await fetchAllMessages(CHANNEL_ID, state.lastMessageId);

  if (messages.length === 0) {
    console.log('No new messages. Done.');
    return;
  }

  // Process messages and extract tracks
  const newTracks = [];
  for (const msg of messages) {
    const links = extractLinks(msg.content);
    if (links.length === 0) continue;

    // Resolve poster nickname
    const user = await fetchMemberNick(GUILD_ID, msg.author);

    for (const link of links) {
      const key = `${link.type}:${link.id}`;
      if (existingKeys.has(key)) continue; // skip duplicates

      // Fetch metadata (title, artist, thumbnail)
      const meta = await fetchMetadata(link.type, link.id, link.subtype, link.originalUrl);

      newTracks.push({
        type: link.type,
        id: link.id,
        subtype: link.subtype || null,
        title: meta.title,
        artist: meta.artist,
        thumbnailUrl: meta.thumbnailUrl,
        embedUrl: meta.embedUrl || null,
        streamUrl: meta.streamUrl || null,
        audioUrl: null,
        user,
        postedAt: msg.timestamp,
        messageId: msg.id,
        originalUrl: link.originalUrl,
      });

      existingKeys.add(key);
      console.log(`  + ${link.type}: ${meta.title} (by ${user})`);
    }
  }

  console.log(`New tracks found: ${newTracks.length}`);

  // Auto-resolve Spotify albums/playlists to their most popular track
  if (hasSpotifyCredentials()) {
    for (const track of newTracks) {
      if (track.type !== 'spotify') continue;
      const isAlbum = track.subtype === 'album';
      const isPlaylist = track.subtype === 'playlist';
      if (!isAlbum && !isPlaylist) continue;

      try {
        const result = isAlbum
          ? await getMostPopularAlbumTrack(track.id)
          : await getMostPopularPlaylistTrack(track.id);

        if (result) {
          console.log(`  Resolved ${track.subtype} "${track.title}" → "${result.title}"`);
          // Remove old key, add new one
          existingKeys.delete(`spotify:${track.id}`);
          track.albumUrl = result.albumUrl;
          track.albumTitle = result.albumTitle;
          track.id = result.trackId;
          track.subtype = 'track';
          track.originalUrl = `https://open.spotify.com/track/${result.trackId}`;
          // Re-fetch metadata for the resolved track
          const meta = await fetchMetadata('spotify', result.trackId, 'track');
          track.title = meta.title;
          track.thumbnailUrl = meta.thumbnailUrl;
          existingKeys.add(`spotify:${track.id}`);
        }
      } catch (err) {
        console.warn(`  Could not resolve ${track.subtype} "${track.title}": ${err.message}`);
        // Leave as-is — will play via Spotify embed fallback
      }
    }
  } else {
    const unresolvedCount = newTracks.filter(
      (t) => t.type === 'spotify' && (t.subtype === 'album' || t.subtype === 'playlist')
    ).length;
    if (unresolvedCount > 0) {
      console.log(`  ${unresolvedCount} album/playlist entries skipped (no Spotify API credentials)`);
    }
  }

  // Merge and sort (most recent first)
  const allTracks = [...existingTracks, ...newTracks].sort(
    (a, b) => new Date(b.postedAt) - new Date(a.postedAt)
  );

  // Write tracks.json
  await writeFile(TRACKS_PATH, JSON.stringify(allTracks, null, 2) + '\n');
  console.log(`Wrote ${allTracks.length} tracks to tracks.json`);

  // Update cursor to the newest message we saw
  const newestId = messages[messages.length - 1].id;
  await saveState({ lastMessageId: newestId });
  console.log(`Updated cursor to ${newestId}`);
}

main().catch((err) => {
  console.error('Scrape failed:', err);
  process.exit(1);
});
