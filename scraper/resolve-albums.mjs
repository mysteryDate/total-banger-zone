/**
 * One-time script to resolve album/playlist entries into single tracks.
 * Run: node scraper/resolve-albums.mjs
 *
 * For each album/playlist in the RESOLUTIONS map:
 * - Fetches metadata for the replacement track via Spotify oEmbed
 * - Replaces the album entry in tracks.json with a single-track entry
 * - Preserves original user, postedAt, messageId
 * - Adds albumUrl and albumTitle pointing to the original album/playlist
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRACKS_PATH = resolve(__dirname, '..', 'tracks.json');

// Map of album/playlist Spotify ID → replacement track info
// albumTitle is the original album/playlist name (for breadcrumb)
const RESOLUTIONS = [
  {
    albumId: '4242hiYk7PAArDAd6XSWbZ',
    albumTitle: 'Dancing For Mental Health',
    trackId: '4cbAnEG2tY1nIS1T5jeEf7',
    trackName: 'Kissing With Confidence',
  },
  {
    albumId: '4zTve3KmaKstuT61AyoGjV',
    albumTitle: 'Penthouse',
    trackId: '66ZWRUlzpvgW1uc3yXNUqP',
    trackName: 'Chinatown',
  },
  {
    albumId: '5jeqGMqvbwCpwDg5bTZ5SI',
    albumTitle: 'The Toad King',
    trackId: '0OAFbTeLkdqUO6t9H2ybGx',
    trackName: 'Birth of the Toad King',
  },
  {
    albumId: '7C0IAJ3u8KenVJHKFGeZ85',
    albumTitle: 'The Lamb Lies Down On Broadway (50th Anniversary Deluxe Edition)',
    trackId: '3kJfwXimSnNMa4KFO3jixZ',
    trackName: 'The Carpet Crawlers - 2025 Remaster',
  },
  {
    albumId: '0EMnfWB37amlYLEuQzoV3k',
    albumTitle: 'Prize',
    trackId: '1Lg05w5ZMnfx8ZBkC6txLU',
    trackName: 'Sore',
  },
  {
    // This is actually a single with one track
    albumId: '3lJxxnQzyaqQWZBKPeokZK',
    albumTitle: 'Đắp Chăn Bông',
    trackId: '6CMROH0r43Pot5yE955p2T',
    trackName: 'Đắp Chăn Bông',
  },
  {
    // Playlist — pick "Harder, Better, Faster, Stronger" by Daft Punk
    albumId: '0Bkc5tE49gOjMrFavC1sN4',
    albumTitle: '2004 Facebook coding jams',
    trackId: '5W3cjX2J3tjhG8zb6u0qHn',
    trackName: 'Harder, Better, Faster, Stronger',
  },
  {
    albumId: '05hetyzbR8Vg3rjYUqsLW5',
    albumTitle: 'Soothing Sounds for Baby: Vol. 1',
    trackId: '6LsL9rEulECwJn8yyoHriJ',
    trackName: 'Lullaby',
  },
  {
    albumId: '0z8Lnbz84Irq0iBQcTS4es',
    albumTitle: 'Schubert: Songs without Words',
    trackId: '2S71Qshkct9aMo2PrenMa8',
    trackName: 'Arpeggione Sonata in A Minor, D. 821: I. Allegro moderato',
  },
];

const UNRESOLVED = [];

async function fetchTrackMetadata(trackId) {
  const url = `https://open.spotify.com/oembed?url=https://open.spotify.com/track/${trackId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Spotify oEmbed ${res.status} for track ${trackId}`);
  const data = await res.json();
  return {
    title: data.title,
    thumbnailUrl: data.thumbnail_url,
  };
}

async function main() {
  const tracks = JSON.parse(await readFile(TRACKS_PATH, 'utf-8'));
  let resolved = 0;

  for (const resolution of RESOLUTIONS) {
    const idx = tracks.findIndex(
      (t) => t.type === 'spotify' && t.id === resolution.albumId
    );
    if (idx === -1) {
      console.log(`  Skipping ${resolution.albumTitle} — not found in tracks.json`);
      continue;
    }

    const original = tracks[idx];
    console.log(`Resolving: ${original.title} → ${resolution.trackName}`);

    // Fetch metadata for the replacement track
    const meta = await fetchTrackMetadata(resolution.trackId);

    // Replace the entry, preserving user/date/message info
    tracks[idx] = {
      type: 'spotify',
      id: resolution.trackId,
      subtype: 'track',
      title: meta.title,
      artist: original.artist,
      thumbnailUrl: meta.thumbnailUrl,
      embedUrl: null,
      streamUrl: null,
      audioUrl: null,
      albumUrl: `https://open.spotify.com/${original.subtype}/${resolution.albumId}`,
      albumTitle: resolution.albumTitle,
      user: original.user,
      postedAt: original.postedAt,
      messageId: original.messageId,
      originalUrl: `https://open.spotify.com/track/${resolution.trackId}`,
    };

    resolved++;
  }

  await writeFile(TRACKS_PATH, JSON.stringify(tracks, null, 2) + '\n');
  console.log(`\nResolved ${resolved} entries.`);

  if (UNRESOLVED.length > 0) {
    console.log('\nStill need manual resolution:');
    for (const u of UNRESOLVED) {
      console.log(`  - ${u.title}: https://open.spotify.com/album/${u.albumId}`);
      console.log('    Open the album on Spotify, pick a track, add its ID to RESOLUTIONS, re-run.');
    }
  }
}

main().catch((err) => {
  console.error('Resolve failed:', err);
  process.exit(1);
});
