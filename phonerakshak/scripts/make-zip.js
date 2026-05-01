#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const archiver = require(path.join(__dirname, '..', 'server', 'node_modules', 'archiver'));

const outDir = path.join(__dirname, '..', 'downloads');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'PhoneRakshak-source.zip');

const output = fs.createWriteStream(outPath);
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => {
  const mb = (archive.pointer() / 1024 / 1024).toFixed(2);
  console.log(`Wrote ${outPath}  (${mb} MB, ${archive.pointer()} bytes)`);
});
archive.on('warning', (e) => console.warn('warn:', e));
archive.on('error', (e) => { throw e; });
archive.pipe(output);

const ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.cache', '.local', '.agents',
  'attached_assets', 'downloads', 'build', '.gradle', '.idea',
]);
const SKIP_FILES = new Set(['.DS_Store', 'zipFile.zip']);
const SKIP_PATHS = new Set([
  // Live runtime data — not source
  path.join('server', 'data', 'db.json'),
]);

function walk(dir, rel = '') {
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('.') && !['.replit', '.gitignore'].includes(name)) {
      if (SKIP_DIRS.has(name)) continue;
      // allow hidden config files explicitly listed; skip everything else hidden
      if (![ '.replit', '.gitignore' ].includes(name)) continue;
    }
    if (SKIP_DIRS.has(name) || SKIP_FILES.has(name)) continue;
    const full = path.join(dir, name);
    const relPath = path.join(rel, name);
    if (SKIP_PATHS.has(relPath)) continue;
    // Skip uploaded photos but keep the folder via a placeholder.
    if (relPath.startsWith(path.join('server', 'data', 'intruders'))) continue;
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      walk(full, relPath);
    } else {
      archive.file(full, { name: relPath });
    }
  }
}

walk(ROOT);
// Ensure intruders folder exists in the unzipped project.
archive.append('Uploaded intruder photos go here.\n', { name: 'server/data/intruders/.gitkeep' });

archive.finalize();
