import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { createR2Client, audioObjectKey, R2_BUCKET } from './r2.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BLOCKLIST_PATH = resolve(__dirname, 'blocklist.json');
const TRACKS_PATH = resolve(__dirname, '..', 'tracks.json');

async function loadBlocklist() {
  try {
    return JSON.parse(await readFile(BLOCKLIST_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

async function main() {
  const key = process.argv[2];
  if (!key || !key.includes(':')) {
    console.error('Usage: npm run remove -- <type>:<id>   e.g. youtube:RxqOeqC3Ht8');
    process.exit(1);
  }

  const tracks = JSON.parse(await readFile(TRACKS_PATH, 'utf-8'));
  const track = tracks.find((t) => `${t.type}:${t.id}` === key);
  if (!track) {
    console.error(`No track matching ${key} in tracks.json`);
    process.exit(1);
  }

  console.log(`Removing ${key} — "${track.title}" (posted by ${track.user} on ${track.postedAt})`);

  if (track.audioUrl) {
    const objectKey = audioObjectKey(track.type, track.id);
    await createR2Client().send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: objectKey }));
    console.log(`  deleted ${R2_BUCKET}/${objectKey} from R2`);
  }

  const remaining = tracks.filter((t) => t !== track);
  await writeFile(TRACKS_PATH, JSON.stringify(remaining, null, 2) + '\n');
  console.log(`  removed from tracks.json (${remaining.length} tracks remain)`);

  const blocklist = await loadBlocklist();
  if (!blocklist.includes(key)) {
    blocklist.push(key);
    await writeFile(BLOCKLIST_PATH, JSON.stringify(blocklist, null, 2) + '\n');
    console.log('  added to blocklist.json');
  }
}

main().catch((err) => {
  console.error('Remove failed:', err);
  process.exit(1);
});
