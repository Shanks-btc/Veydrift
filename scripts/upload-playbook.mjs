#!/usr/bin/env node
/**
 * scripts/upload-playbook.mjs
 *
 * One-time upload: packs veydrift-playbook/ into a tar.gz in memory
 * (no disk writes, no npm packages) and POSTs it to GetAgent Cloud.
 *
 * Usage (Railway shell — avoids UK geo-restriction):
 *   node scripts/upload-playbook.mjs
 *
 * Requires GETAGENT_KEY to be set in the environment.
 * On Railway that env var lives in the project's Variables panel.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname }                       from 'node:path';
import { gzipSync }                            from 'node:zlib';
import { fileURLToPath }                        from 'node:url';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT  = join(__dirname, '..');
const PKG_DIR    = join(REPO_ROOT, 'veydrift-playbook');
const UPLOAD_URL = 'https://api.bitget.com/api/v1/playbook/upload';

// ── tar builder ───────────────────────────────────────────────────────────────
// Produces a valid POSIX ustar archive as a Buffer.
// Archive paths are relative to PKG_DIR (e.g. "manifest.yaml", "src/main.py").

function makeTarHeader(arcPath, fileSize, mtimeSec, isDir) {
  const block = Buffer.alloc(512);

  // name: up to 100 bytes, null-padded
  Buffer.from(isDir ? arcPath + '/' : arcPath, 'utf8').subarray(0, 100).copy(block, 0);

  const octal = (n, offset, width) => {
    const s = n.toString(8).padStart(width - 1, '0') + '\0';
    block.write(s.slice(0, width), offset, 'ascii');
  };

  block.write(isDir ? '0000755\0' : '0000644\0', 100, 'ascii'); // mode
  block.write('0000000\0', 108, 'ascii');                        // uid
  block.write('0000000\0', 116, 'ascii');                        // gid
  octal(isDir ? 0 : fileSize, 124, 12);                         // size
  octal(mtimeSec, 136, 12);                                      // mtime
  block.fill(0x20, 148, 156);                                    // checksum placeholder
  block[156] = isDir ? 0x35 : 0x30;                             // typeflag: '5' / '0'
  block.write('ustar\0', 257, 'ascii');                          // magic
  block.write('00', 263, 'ascii');                               // version

  // compute and write checksum
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += block[i];
  block.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');

  return block;
}

const SKIP_NAMES = new Set(['.DS_Store', '__pycache__', '.git']);
const SKIP_EXTS  = new Set(['.pyc', '.pyo']);

function buildTar(baseDir) {
  const chunks = [];

  function walk(absDir, arcPrefix) {
    const entries = readdirSync(absDir, { withFileTypes: true })
      .filter(e => !SKIP_NAMES.has(e.name) && !SKIP_EXTS.has(e.name.slice(e.name.lastIndexOf('.'))))
      .sort((a, b) => (a.name < b.name ? -1 : 1));

    for (const entry of entries) {
      const absPath = join(absDir, entry.name);
      const arcPath = arcPrefix ? `${arcPrefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        const st = statSync(absPath);
        chunks.push(makeTarHeader(arcPath, 0, Math.floor(st.mtimeMs / 1000), true));
        walk(absPath, arcPath);
      } else if (entry.isFile()) {
        const st      = statSync(absPath);
        const content = readFileSync(absPath);
        chunks.push(makeTarHeader(arcPath, content.length, Math.floor(st.mtimeMs / 1000), false));
        chunks.push(content);
        const pad = (512 - (content.length % 512)) % 512;
        if (pad > 0) chunks.push(Buffer.alloc(pad));
      }
    }
  }

  walk(baseDir, '');
  chunks.push(Buffer.alloc(1024)); // two zero blocks = end of archive
  return Buffer.concat(chunks);
}

// ── main ──────────────────────────────────────────────────────────────────────

const key = process.env.GETAGENT_KEY;
if (!key) {
  console.error('Error: GETAGENT_KEY environment variable is not set.');
  console.error('Set it in Railway Variables, then re-run.');
  process.exit(1);
}

console.log(`Packing  ${PKG_DIR}`);
const tar = buildTar(PKG_DIR);
const gz  = gzipSync(tar, { level: 9 });
console.log(`Packed   ${(gz.length / 1024).toFixed(1)} KB`);

console.log(`Uploading to ${UPLOAD_URL} ...`);
const blob = new Blob([gz], { type: 'application/gzip' });
const form = new FormData();
form.append('package', blob, 'veydrift-playbook.tar.gz');

const r = await fetch(UPLOAD_URL, {
  method: 'POST',
  headers: { 'ACCESS-KEY': key },
  body: form,
});

const rawText = await r.text();
console.log('RAW:', rawText);

let parsed;
try {
  parsed = JSON.parse(rawText);
} catch {
  console.error('Response is not valid JSON — see RAW above');
  process.exit(1);
}
console.log('PARSED:', JSON.stringify(parsed, null, 2));

if (!r.ok) {
  console.error(`Upload failed — HTTP ${r.status}`);
  process.exit(1);
}

console.log('\nUpload successful!');
console.log(`  draft_id    : ${parsed.draft_id}`);
console.log(`  strategy_id : ${parsed.strategy_id}`);
console.log(`  name        : ${parsed.name}`);
console.log(`  status      : ${parsed.status}`);
