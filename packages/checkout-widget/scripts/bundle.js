const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');
const OUTFILE = path.join(ROOT, 'dist', 'tokento-widget.js');
const LIMIT_BYTES = 10 * 1024;

async function main() {
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'src', 'widget.ts')],
    outfile: OUTFILE,
    bundle: true,
    minify: true,
    target: ['es2018'],
    platform: 'browser',
    format: 'iife',
    legalComments: 'none',
  });

  const raw = fs.readFileSync(OUTFILE);
  const gzipped = zlib.gzipSync(raw, { level: zlib.constants.Z_BEST_COMPRESSION });

  const rawKb = (raw.length / 1024).toFixed(2);
  const gzipKb = (gzipped.length / 1024).toFixed(2);
  process.stdout.write(`Built tokento-widget.js (${rawKb}KB raw, ${gzipKb}KB gzip)\n`);

  if (gzipped.length > LIMIT_BYTES) {
    throw new Error(`Widget bundle exceeds 10KB gzip budget: ${gzipped.length} bytes.`);
  }
}

main().catch((err) => {
  process.stderr.write(`${String(err?.message || err)}\n`);
  process.exit(1);
});
