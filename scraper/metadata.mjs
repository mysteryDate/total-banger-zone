/**
 * Fetch metadata for a track using oEmbed APIs.
 * Returns { title, artist, thumbnailUrl }.
 */
export async function fetchMetadata(type, id, subtype = 'track', originalUrl = null) {
  try {
    if (type === 'youtube') {
      return await fetchYouTubeMetadata(id);
    }
    if (type === 'spotify') {
      return await fetchSpotifyMetadata(id, subtype);
    }
    if (type === 'bandcamp') {
      return await fetchBandcampMetadata(id, originalUrl);
    }
  } catch (err) {
    console.warn(`Failed to fetch metadata for ${type}:${id}:`, err.message);
  }

  // Fallback
  const typeNames = { youtube: 'YouTube', spotify: 'Spotify', bandcamp: 'Bandcamp' };
  return {
    title: `${typeNames[type] || type} Track (${id})`,
    artist: null,
    thumbnailUrl: null,
    embedUrl: null,
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

async function fetchBandcampMetadata(id, originalUrl) {
  // Reconstruct URL from ID if originalUrl not provided
  const url = originalUrl || (() => {
    const [artist, track] = id.split('/');
    return `https://${artist}.bandcamp.com/track/${track}`;
  })();

  // Bandcamp's oEmbed API is defunct — scrape OG meta tags from the track page
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Bandcamp page ${res.status}`);
  const html = await res.text();

  const og = (prop) => {
    const m = html.match(new RegExp(`<meta\\s+property="og:${prop}"\\s+content="([^"]*)"`, 'i'));
    return m ? m[1] : null;
  };

  // og:title is "Track Name, by Artist Name"
  const ogTitle = og('title') || id;
  const titleParts = ogTitle.split(', by ');
  const title = titleParts[0];
  const artist = titleParts.length > 1 ? titleParts.slice(1).join(', by ') : og('site_name');
  const thumbnailUrl = og('image') || null;

  // Extract numeric track ID from bc-page-properties for embed URL
  let embedUrl = null;
  const propsMatch = html.match(/bc-page-properties[^>]+content="([^"]+)"/i);
  if (propsMatch) {
    try {
      const props = JSON.parse(propsMatch[1].replace(/&quot;/g, '"'));
      if (props.item_id) {
        embedUrl = `https://bandcamp.com/EmbeddedPlayer/v=2/track=${props.item_id}/size=large/tracklist=false/artwork=small/`;
      }
    } catch {}
  }

  // Extract direct mp3 stream URL from data-tralbum JSON
  let streamUrl = null;
  const tralbumMatch = html.match(/data-tralbum="([^"]+)"/);
  if (tralbumMatch) {
    try {
      const tralbum = JSON.parse(tralbumMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
      streamUrl = tralbum.trackinfo?.[0]?.file?.['mp3-128'] || null;
    } catch {}
  }

  return { title, artist, thumbnailUrl, embedUrl, streamUrl };
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
