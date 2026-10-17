import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const html = await readFile(new URL('index.html', root), 'utf8');
const attributes = tag => Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)].map(match => [match[1], match[3]]));
const links = [...html.matchAll(/<link\b[^>]*>/g)].map(match => attributes(match[0]));
const metas = [...html.matchAll(/<meta\b[^>]*>/g)].map(match => attributes(match[0]));
const meta = name => metas.find(item => item.name === name || item.property === name)?.content;
const canonicals = links.filter(link => link.rel === 'canonical');
assert.equal(canonicals.length, 1, 'Publish exactly one canonical URL');
const canonical = new URL(canonicals[0].href);
assert.equal(canonical.protocol, 'https:');
assert.equal(canonical.pathname, '/');
assert.ok(!canonical.search && !canonical.hash);
assert.match(html.match(/<title>(.*?)<\/title>/s)?.[1] ?? '', /Prescriptris.*Pharmacy.*Puzzle/);
assert.ok(meta('description'), 'The page needs a search description');
assert.ok(!/noindex/i.test(meta('robots') ?? ''), 'The current game must remain indexable');
assert.equal(meta('og:url'), canonical.href, 'Social and canonical URLs must agree');
console.log('PASS: page identity and indexing metadata');

const json = html.match(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/)?.[1];
assert.ok(json, 'Game structured data must be present in the initial HTML');
const schema = JSON.parse(json);
assert.equal(schema['@context'], 'https://schema.org');
const graph = schema['@graph'];
assert.ok(Array.isArray(graph));
const game = graph.find(item => [item['@type']].flat().includes('VideoGame'));
assert.ok(game, 'Structured data must describe the game');
assert.equal(game.url, canonical.href);
assert.equal(game.isAccessibleForFree, true);
assert.equal(game.offers.price, 0);
assert.ok(game.description && game.gamePlatform);
const ids = new Set(graph.map(item => item['@id']));
function checkReferences(value) {
  if (!value || typeof value !== 'object') return;
  if (value['@id']) assert.ok(ids.has(value['@id']), `Unresolved entity: ${value['@id']}`);
  Object.values(value).forEach(checkReferences);
}
checkReferences(graph);
console.log('PASS: parseable game schema and connected entities');

const idsInHtml = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
const tags = [...html.matchAll(/<(?:a|img|link|script)\b[^>]*>/g)].map(match => attributes(match[0]));
let checked = 0;
for (const tag of tags) {
  const reference = tag.src || tag.href;
  if (!reference) continue;
  const url = new URL(reference, canonical);
  if (url.origin !== canonical.origin) continue;
  if (url.hash && url.pathname === '/') assert.ok(idsInHtml.has(decodeURIComponent(url.hash.slice(1))), `Broken anchor: ${reference}`);
  const file = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  await access(new URL(file, root));
  checked++;
}
assert.ok(idsInHtml.has('about') && idsInHtml.has('how-to-play') && idsInHtml.has('faq'), 'Readable game information must exist outside the canvas');
console.log(`PASS: ${checked} local resource links and content anchors`);

for (const reference of [meta('og:image'), meta('twitter:image'), game.image, game.screenshot]) {
  assert.ok(reference, 'A real gameplay image must be specified');
  const url = new URL(reference);
  assert.equal(url.origin, canonical.origin);
  await access(new URL(url.pathname.slice(1), root));
}
assert.equal(meta('twitter:card'), 'summary_large_image');
console.log('PASS: social and game image resources');

const robots = await readFile(new URL('robots.txt', root), 'utf8');
assert.match(robots, /User-agent:\s*\*/i);
assert.match(robots, /Allow:\s*\//i);
assert.ok(!/^Disallow:\s*\/\s*$/im.test(robots), 'Public search crawlers must not be blocked');
assert.ok(robots.includes(`Sitemap: ${new URL('sitemap.xml', canonical).href}`));
const sitemap = await readFile(new URL('sitemap.xml', root), 'utf8');
assert.ok(sitemap.includes('http://www.sitemaps.org/schemas/sitemap/0.9'));
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
assert.ok(urls.includes(canonical.href));
assert.equal(new Set(urls).size, urls.length);
for (const address of urls) {
  const url = new URL(address);
  assert.equal(url.origin, canonical.origin);
  assert.ok(!url.hash && !url.search);
  const file = url.pathname.endsWith('/') ? `${url.pathname.slice(1)}index.html` : url.pathname.slice(1);
  const source = await readFile(new URL(file, root), 'utf8');
  assert.ok(!/<meta\b[^>]*content="[^"]*noindex/i.test(source), `Sitemap includes a noindex page: ${address}`);
}
console.log('PASS: crawl permissions and canonical sitemap');

const legacy = await readFile(new URL('old.html', root), 'utf8');
assert.match(legacy, /name="robots" content="noindex,follow"/);
console.log(`PASS: legacy game excluded from indexing; checked ${fileURLToPath(root)}`);
