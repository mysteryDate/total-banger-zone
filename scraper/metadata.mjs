/**
 * Fetch metadata for a track using oEmbed APIs.
 * Returns { title, artist, thumbnailUrl }.
 */
export async function fetchMetadata(type, id, subtype = 'track') {
  try {
    if (type === 'youtube') {
      return await fetchYouTubeMetadata(id);
    }
    if (type === 'spotify') {
      return await fetchSpotifyMetadata(id, subtype);
    }
  } catch (err) {
    console.warn(`Failed to fetch metadata for ${type}:${id}:`, err.message);
  }

  // Fallback
  return {
    title: `${type === 'youtube' ? 'YouTube' : 'Spotify'} Track (${id})`,
    artist: null,
    thumbnailUrl: null,
  };
}

async function fetchYouTubeMetadata(videoId) {
  const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`YouTube oEmbed ${res.status}`);
  const data = await res.json();
  return {
    title: data.title,
    artist: data.author_name,
    thumbnailUrl: data.thumbnail_url,
  };
}

async function fetchSpotifyMetadata(id, subtype) {
  const url = `https://open.spotify.com/oembed?url=https://open.spotify.com/${subtype}/${id}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Spotify oEmbed ${res.status}`);
  const data = await res.json();
  return {
    title: data.title,
    artist: null, // Spotify oEmbed title typically includes artist
    thumbnailUrl: data.thumbnail_url,
  };
}
