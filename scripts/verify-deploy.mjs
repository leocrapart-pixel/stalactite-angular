/**
 * Verify that what is deployed is what you built.
 *
 * Angular emits a shell plus hashed bundles, so this checks the shell and every
 * asset it references against `dist/`. A deploy that uploaded stale or partial
 * files fails here rather than in the browser.
 *
 *   node scripts/verify-deploy.mjs [base-url]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] ?? 'https://stalactite-svelte.stalactite.workers.dev';
const LOCAL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

async function crawl() {
  const html = await (await fetch(BASE + '/')).text();
  // Angular writes relative asset paths, so match anything script/link points at
  const seeds = [...html.matchAll(/(?:href|src)="([^"]+\.(?:js|css))"/g)]
    .map((m) => m[1])
    .filter((u) => !u.startsWith('data:') && !/^https?:/.test(u))
    .map((u) => (u.startsWith('/') ? u : '/' + u));
  const seen = new Map();
  const queue = [...new Set(seeds)];
  while (queue.length) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    const res = await fetch(BASE + url);
    if (!res.ok) { seen.set(url, null); continue; }
    const body = await res.text();
    seen.set(url, body);
    for (const m of body.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+\.js)["']/g)) {
      const abs = path.posix.normalize(path.posix.join(path.posix.dirname(url), m[1]));
      if (!seen.has(abs)) queue.push(abs);
    }
  }
  return { html, modules: seen };
}

(async () => {
  const { html, modules } = await crawl();
  let same = 0, diff = 0, missing = 0;
  for (const [url, body] of modules) {
    if (body === null) { missing++; console.log(`  MISSING on server: ${url}`); continue; }
    const localPath = path.join(LOCAL, url.replace(/^\//, ''));
    if (!fs.existsSync(localPath)) { missing++; console.log(`  not in local build: ${url}`); continue; }
    const localBody = fs.readFileSync(localPath, 'utf8');
    if (hash(localBody) === hash(body)) same++;
    else { diff++; console.log(`  DIFFERS: ${url}  local=${hash(localBody)} live=${hash(body)}`); }
  }
  const localHtml = fs.readFileSync(path.join(LOCAL, 'index.html'), 'utf8');
  const htmlSame = hash(localHtml) === hash(html);
  console.log('');
  console.log(`modules identical: ${same}   differing: ${diff}   missing: ${missing}`);
  console.log(`shell identical: ${htmlSame}`);
  console.log(htmlSame && diff === 0 && missing === 0
    ? 'DEPLOYED BUILD IS BYTE-IDENTICAL TO THE LOCALLY VERIFIED BUILD'
    : 'DEPLOYED BUILD DIFFERS FROM LOCAL');
  process.exit(htmlSame && diff === 0 && missing === 0 ? 0 : 1);
})();
