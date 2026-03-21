// Registry of music link extractors.
// Each entry: { type, pattern, getId(url), embedUrl(id) }

const extractors = [
  {
    type: 'youtube',
    pattern: /(?:(?:youtube\.com|music\.youtube\.com)\/watch\?[^\s]*v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    getId(url) {
      const m = url.match(this.pattern);
      return m ? m[1] : null;
    },
    embedUrl(id) {
      return `https://www.youtube.com/embed/${id}`;
    },
  },
  {
    type: 'spotify',
    pattern: /open\.spotify\.com\/(track|album|playlist)\/([a-zA-Z0-9]+)/,
    getId(url) {
      const m = url.match(this.pattern);
      return m ? m[2] : null;
    },
    getSubtype(url) {
      const m = url.match(this.pattern);
      return m ? m[1] : 'track';
    },
    embedUrl(id, subtype = 'track') {
      return `https://open.spotify.com/embed/${subtype}/${id}`;
    },
  },
];

/**
 * Extract all music links from a message's text content.
 * Returns an array of { type, id, subtype?, originalUrl }.
 */
export function extractLinks(text) {
  if (!text) return [];

  // Find all URLs in the message
  const urlPattern = /https?:\/\/[^\s<>]+/g;
  const urls = text.match(urlPattern) || [];
  const results = [];

  for (const url of urls) {
    for (const ext of extractors) {
      const id = ext.getId(url);
      if (id) {
        const entry = { type: ext.type, id, originalUrl: url };
        if (ext.getSubtype) {
          entry.subtype = ext.getSubtype(url);
        }
        results.push(entry);
        break; // one match per URL
      }
    }
  }

  return results;
}

/**
 * Build an embed URL for a given track.
 */
export function buildEmbedUrl(type, id, subtype) {
  const ext = extractors.find((e) => e.type === type);
  if (!ext) return null;
  return ext.embedUrl(id, subtype);
}
