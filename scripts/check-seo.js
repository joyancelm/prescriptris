import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const files = ['index.html', 'how-to-play/index.html', 'faq/index.html'];
const attributes = tag => Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)].map(match => [match[1], match[3]]));
const localPath = url => decodeURIComponent(url.pathname.slice(1)) + (url.pathname.endsWith('/') ? 'index.html' : '');
const pages = [];
for (const file of files) {
  const html = await readFile(new URL(file, root), 'utf8');
  const links = [...html.matchAll(/<link\b[^>]*>/g)].map(match => attributes(match[0]));
  const metas = [...html.matchAll(/<meta\b[^>]*>/g)].map(match => attributes(match[0]));
  const meta = name => metas.find(item => item.name === name || item.property === name)?.content;
  const canonicals = links.filter(link => link.rel === 'canonical');
  assert.equal(canonicals.length, 1, `${file}: exactly one canonical URL is required`);
  const canonical = new URL(canonicals[0].href);
  assert.equal(canonical.protocol, 'https:');
  assert.ok(!canonical.search && !canonical.hash);
  assert.equal(localPath(canonical), file, `${file}: canonical URL must identify this page`);
  const title = html.match(/<title>(.*?)<\/title>/s)?.[1] ?? '';
  assert.match(title, /Prescriptris/);
  assert.ok(meta('description'), `${file}: missing search description`);
  assert.ok(!/noindex/i.test(meta('robots') ?? ''), `${file}: public page must remain indexable`);
  assert.equal(meta('og:url'), canonical.href);
  assert.equal((html.match(/<h1\b/g) ?? []).length, 1, `${file}: provide one main heading`);
  const json = html.match(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(json, `${file}: structured data is missing`);
  const schema = JSON.parse(json);
  assert.equal(schema['@context'], 'https://schema.org');
  const nodes = schema['@graph'] ?? [schema];
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  pages.push({ file, html, title, canonical, meta, nodes, ids });
}
const home = pages[0];
for (const page of pages) assert.equal(page.canonical.origin, home.canonical.origin);
assert.equal(new Set(pages.map(page => page.title)).size, pages.length, 'Give each page its own search title');
assert.equal(new Set(pages.map(page => page.meta('description'))).size, pages.length, 'Give each page its own search description');
console.log(`PASS: unique titles, canonicals, and indexing metadata for ${pages.length} pages`);

const entities = new Set(pages.flatMap(page => page.nodes.map(node => node['@id'])));
function checkReferences(value) {
  if (!value || typeof value !== 'object') return;
  if (value['@id']) assert.ok(entities.has(value['@id']), `Unresolved entity: ${value['@id']}`);
  Object.values(value).forEach(checkReferences);
}
pages.forEach(page => checkReferences(page.nodes));
const game = home.nodes.find(node => [node['@type']].flat().includes('VideoGame'));
assert.ok(game);
assert.equal(game.url, home.canonical.href);
assert.equal(game.isAccessibleForFree, true);
assert.equal(game.offers.price, 0);
assert.ok(pages.some(page => page.canonical.href === game.softwareHelp.url), 'Game help must point to a published page');
console.log('PASS: connected website, game, and help-page entities');

let checked = 0;
for (const page of pages) {
  const tags = [...page.html.matchAll(/<(?:a|img|link|script)\b[^>]*>/g)].map(match => attributes(match[0]));
  for (const tag of tags) {
    if (tag.target === '_blank') assert.ok(tag.rel?.split(/\s+/).includes('noopener'), 'New-tab help links must isolate the new page');
    const reference = tag.src || tag.href;
    if (!reference) continue;
    const url = new URL(reference, page.canonical);
    if (url.origin !== home.canonical.origin) continue;
    await access(new URL(localPath(url), root));
    if (url.hash) {
      const target = pages.find(candidate => candidate.canonical.pathname === url.pathname);
      assert.ok(target?.ids.has(decodeURIComponent(url.hash.slice(1))), `Broken anchor: ${reference} on ${page.file}`);
    }
    checked++;
  }
  for (const reference of [page.meta('og:image'), page.meta('twitter:image')]) {
    assert.ok(reference);
    const url = new URL(reference);
    assert.equal(url.origin, home.canonical.origin);
    await access(new URL(localPath(url), root));
  }
  assert.equal(page.meta('twitter:card'), 'summary_large_image');
}
console.log(`PASS: ${checked} local page/resource links, anchors, and social images`);

const robots = await readFile(new URL('robots.txt', root), 'utf8');
assert.match(robots, /User-agent:\s*\*/i);
assert.match(robots, /Allow:\s*\//i);
assert.ok(!/^Disallow:\s*\/\s*$/im.test(robots));
assert.ok(robots.includes(`Sitemap: ${new URL('sitemap.xml', home.canonical).href}`));
const sitemap = await readFile(new URL('sitemap.xml', root), 'utf8');
assert.ok(sitemap.includes('http://www.sitemaps.org/schemas/sitemap/0.9'));
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
assert.equal(new Set(urls).size, urls.length);
assert.deepEqual([...urls].sort(), pages.map(page => page.canonical.href).sort(), 'The sitemap must include all public pages and no stale routes');
const legacy = await readFile(new URL('old.html', root), 'utf8');
assert.match(legacy, /name="robots" content="noindex,follow"/);
console.log('PASS: crawler permissions, three-page sitemap, and legacy-page indexing');
