const API_BASE = 'https://discord.com/api/v10';
const token = () => process.env.DISCORD_BOT_TOKEN;

const nickCache = new Map();

async function discordFetch(path) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bot ${token()}` },
  });

  // Handle rate limiting
  if (res.status === 429) {
    const body = await res.json();
    const retryAfter = body.retry_after || 1;
    console.warn(`Rate limited, retrying after ${retryAfter}s...`);
    await sleep(retryAfter * 1000);
    return discordFetch(path);
  }

  // Proactive rate limit respect
  const remaining = res.headers.get('x-ratelimit-remaining');
  const resetAfter = res.headers.get('x-ratelimit-reset-after');
  if (remaining === '0' && resetAfter) {
    console.log(`Rate limit bucket exhausted, waiting ${resetAfter}s...`);
    await sleep(parseFloat(resetAfter) * 1000);
  }

  if (!res.ok) {
    throw new Error(`Discord API ${res.status}: ${await res.text()}`);
  }

  return res.json();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch all messages from a channel.
 *
 * If afterMessageId is provided, fetches messages newer than that ID (incremental).
 * Otherwise, fetches the entire channel history (full backfill using `before`).
 *
 * Returns messages sorted oldest-first.
 */
export async function fetchAllMessages(channelId, afterMessageId) {
  const allMessages = [];

  if (afterMessageId) {
    // Incremental: fetch forward from cursor
    let after = afterMessageId;
    while (true) {
      const params = `limit=100&after=${after}`;
      const batch = await discordFetch(
        `/channels/${channelId}/messages?${params}`
      );
      if (batch.length === 0) break;
      // Discord returns newest-first when using `after`, so reverse
      batch.sort((a, b) => (a.id > b.id ? 1 : -1));
      allMessages.push(...batch);
      after = batch[batch.length - 1].id;
      console.log(`  Fetched ${batch.length} messages (incremental)...`);
    }
  } else {
    // Full backfill: fetch backward from newest
    let before = undefined;
    while (true) {
      const params = before
        ? `limit=100&before=${before}`
        : `limit=100`;
      const batch = await discordFetch(
        `/channels/${channelId}/messages?${params}`
      );
      if (batch.length === 0) break;
      allMessages.push(...batch);
      // batch is newest-first; the oldest is last
      before = batch[batch.length - 1].id;
      console.log(`  Fetched ${batch.length} messages (backfill)...`);
    }
    // Sort oldest-first
    allMessages.sort((a, b) => (a.id > b.id ? 1 : -1));
  }

  console.log(`Total messages fetched: ${allMessages.length}`);
  return allMessages;
}

/**
 * Resolve a user's display name in a guild.
 * Tries server nickname first, falls back to global_name, then username.
 */
export async function fetchMemberNick(guildId, author) {
  const userId = author.id;

  if (nickCache.has(userId)) {
    return nickCache.get(userId);
  }

  try {
    const member = await discordFetch(
      `/guilds/${guildId}/members/${userId}`
    );
    const nick =
      member.nick || author.global_name || author.username;
    nickCache.set(userId, nick);
    return nick;
  } catch {
    // User may have left the server
    const fallback = author.global_name || author.username;
    nickCache.set(userId, fallback);
    return fallback;
  }
}
