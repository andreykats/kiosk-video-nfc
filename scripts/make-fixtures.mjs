// Generates small H.264 test videos in tests/fixtures with ffmpeg.
// Run: npm run fixtures
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = new URL('../tests/fixtures/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const videos = [
  { name: 'loop.mp4', seconds: 4, source: 'testsrc2' },
  { name: 'lion.mp4', seconds: 2, source: 'smptebars' },
  { name: 'tiger.mp4', seconds: 2, source: 'rgbtestsrc' },
];

for (const v of videos) {
  execFileSync(
    'ffmpeg',
    [
      '-y', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `${v.source}=size=320x180:rate=15:duration=${v.seconds}`,
      '-f', 'lavfi', '-i', `sine=frequency=440:duration=${v.seconds}`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-profile:v', 'baseline',
      '-c:a', 'aac', '-b:a', '32k', '-shortest', '-movflags', '+faststart',
      `${out}${v.name}`,
    ],
    { stdio: 'inherit' },
  );
  console.log(`Wrote tests/fixtures/${v.name}`);
}
