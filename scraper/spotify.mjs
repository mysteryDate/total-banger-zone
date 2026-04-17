/**
 * Spotify Web API helpers.
 * Uses Client Credentials flow (no user login needed).
 * Requires SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET env vars.
 *
 * Get these free at https://developer.spotify.com/dashboard
 */

let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET');
  }

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) throw new Error(`Spotify auth failed: ${res.status}`);
  const data = await res.json();

  cachedToken = data.access_token;
  const TOKEN_EXPIRY_BUFFER_MS = 60_000;
  tokenExpiry = Date.now() + data.expires_in * 1000 - TOKEN_EXPIRY_BUFFER_MS;
  return cachedToken;
}

async function spotifyGet(path) {
  const token = await getAccessToken();
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Spotify API ${res.status}: ${path}`);
  return res.json();
}

/**
 * Given an album ID, return the most popular track.
 * Returns { trackId, title, popularity } or null if no tracks.
 */
export async function getMostPopularAlbumTrack(albumId) {
  // Get album tracks (max 50, which covers nearly all albums)
  const album = await spotifyGet(`/albums/${albumId}`);
  const trackIds = album.tracks.items.map((t) => t.id);

  if (trackIds.length === 0) return null;

  // Fetch full track objects (which include popularity)
  const trackData = await spotifyGet(`/tracks?ids=${trackIds.join(',')}`);
  const tracks = trackData.tracks.filter(Boolean);

  // Pick highest popularity, break ties by track number (earlier = better)
  const best = tracks.reduce((a, b) => (b.popularity > a.popularity ? b : a));

  return {
    trackId: best.id,
    title: best.name,
    popularity: best.popularity,
    albumTitle: album.name,
    albumUrl: album.external_urls.spotify,
  };
}

/**
 * Given a playlist ID, return the most popular track.
 * Returns { trackId, title, popularity } or null.
 */
export async function getMostPopularPlaylistTrack(playlistId) {
  const playlist = await spotifyGet(`/playlists/${playlistId}?fields=name,external_urls,tracks.items(track(id,name,popularity))`);
  const tracks = playlist.tracks.items
    .map((item) => item.track)
    .filter(Boolean);

  if (tracks.length === 0) return null;

  const best = tracks.reduce((a, b) => (b.popularity > a.popularity ? b : a));

  return {
    trackId: best.id,
    title: best.name,
    popularity: best.popularity,
    albumTitle: playlist.name,
    albumUrl: playlist.external_urls.spotify,
  };
}

/**
 * Check if Spotify API credentials are configured.
 */
export function hasSpotifyCredentials() {
  return Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
}

/**
 * Get track metadata (title + artist) for a given Spotify track ID.
 * Used to build a YouTube search query for audio download.
 */
export async function getTrackInfo(trackId) {
  const track = await spotifyGet(`/tracks/${trackId}`);
  return {
    title: track.name,
    artist: track.artists.map((a) => a.name).join(', '),
  };
}
