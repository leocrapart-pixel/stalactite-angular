#!/usr/bin/env node
// Report what the build actually weighs, raw and compressed.
//
// Angular prints an estimate in its own summary, but this checks the files on
// disk and fails if the initial bundle drifts past the budget in
// `angular.json` — which is the number a reviewer cares about and the one that
// silently rots when nobody looks.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { join } from 'node:path';

const DIST = new URL('../dist/', import.meta.url).pathname;
const WARN_BYTES = 180 * 1000;
const ERROR_BYTES = 220 * 1000;

const entry = readdirSync(DIST).filter((f) => /^main-.*\.js$/.test(f));
const css = readdirSync(DIST).filter((f) => /^styles-.*\.css$/.test(f));
if (!entry.length) {
  console.error('no main-*.js in dist/ — run `npm run build` first');
  process.exit(1);
}

let raw = 0;
let gzip = 0;
let brotli = 0;
const row = (name, buf) => {
  const g = gzipSync(buf, { level: 9 }).length;
  const b = brotliCompressSync(buf, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 }
  }).length;
  raw += buf.length;
  gzip += g;
  brotli += b;
  console.log(
    `${name.padEnd(28)} ${String(buf.length).padStart(9)} raw ` +
      `${String(g).padStart(8)} gzip ${String(b).padStart(8)} brotli`
  );
};

for (const f of entry) row(f, readFileSync(join(DIST, f)));
for (const f of css) row(f, readFileSync(join(DIST, f)));
row('index.html', readFileSync(join(DIST, 'index.html')));

console.log(
  `${'TOTAL (initial)'.padEnd(28)} ${String(raw).padStart(9)} raw ` +
    `${String(gzip).padStart(8)} gzip ${String(brotli).padStart(8)} brotli`
);

if (raw > ERROR_BYTES) {
  console.error(`\nover budget: ${raw} > ${ERROR_BYTES} bytes`);
  process.exit(1);
}
if (raw > WARN_BYTES) {
  console.warn(`\napproaching the budget: ${raw} > ${WARN_BYTES} bytes`);
}
