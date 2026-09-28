import dns from 'node:dns/promises';
import https from 'node:https';
import { isIP } from 'node:net';
import { normalizeProgress, validatePublicSourceUrl, STORY_LIMITS, type StorySource, type UnitRange } from '../../shared/story';
import type { CharacterEvidence } from '../../shared/characterIdentity';
import type { SourceRef } from '../../shared/world';

const MAX_PAGE_BYTES = 1_500_000;
const MAX_REDIRECTS = 3;
const IDENTITY_EVIDENCE_BYTES = 6_000;
const STORY_EVIDENCE_BYTES = 4_000;
const SCOPED_IDENTITY_EVIDENCE_BYTES = 32_000;

function sourceExcerpt(text: string, maxBytes: number): { text: string; excerpted: boolean } {
  let end = 0;
  let bytes = 0;
  for (const character of text) {
    const size = Buffer.byteLength(character);
    if (bytes + size > maxBytes) break;
    bytes += size;
    end += character.length;
  }
  return { text: text.slice(0, end), excerpted: end < text.length };
}

function publicIpv4(value: string): boolean {
  if (isIP(value) !== 4) return false;
  const [a, b, c] = value.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254
    || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168
    || a === 100 && b >= 64 && b <= 127 || a === 192 && b === 0 && c === 0
    || a === 198 && (b === 18 || b === 19) || a === 198 && b === 51 && c === 100
    || a === 203 && b === 0 && c === 113);
}

async function publicAddress(hostname: string): Promise<string> {
  const addresses = isIP(hostname) === 4 ? [{ address: hostname }] : await dns.lookup(hostname, { all: true, family: 4 });
  if (!addresses.length || addresses.some(item => !publicIpv4(item.address))) throw new Error('Source host must resolve only to public IPv4 addresses');
  return addresses[0].address;
}

export async function readPublicSource(urlText: string, signal: AbortSignal, redirects = 0): Promise<{ url: string; text: string }> {
  const url = validatePublicSourceUrl(urlText);
  if (redirects > MAX_REDIRECTS) throw new Error('Source redirected too many times');
  signal.throwIfAborted();
  const address = await publicAddress(url.hostname);
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: address, servername: url.hostname, path: `${url.pathname}${url.search}`,
      method: 'GET', headers: { Host: url.host, Accept: 'text/plain, text/html, application/json', 'User-Agent': 'mLearn (+https://mlearn.kikan.net)' }, timeout: 15_000 }, res => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        void readPublicSource(new URL(res.headers.location, url).toString(), signal, redirects + 1).then(resolve, reject);
        return;
      }
      if (status !== 200) { res.resume(); reject(new Error(`Source request failed (${status})`)); return; }
      const contentType = String(res.headers['content-type'] ?? '').toLowerCase();
      if (!/^(text\/|application\/json)/.test(contentType)) { res.resume(); reject(new Error('Source returned unsupported content')); return; }
      const chunks: Buffer[] = [];
      let bytes = 0;
      res.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_PAGE_BYTES) { req.destroy(new Error('Source page exceeds the read limit')); return; }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({ url: url.toString(), text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    const abort = (): void => { req.destroy(new Error('Source read cancelled')); };
    signal.addEventListener('abort', abort, { once: true });
    req.on('close', () => signal.removeEventListener('abort', abort));
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Source request timed out')));
    req.end();
  });
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos|nbsp);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const point = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isSafeInteger(point) && point <= 0x10ffff ? String.fromCodePoint(point) : match;
    }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' } as Record<string, string>)[code.toLowerCase()] ?? match;
  });
}

export function plainSourceText(input: string): string {
  return decodeEntities(input
    .replace(/<\/?(?:script|style|nav|footer)\b[^>]*>[\s\S]*?<\/\s*(?:script|style|nav|footer)\s*>/gi, ' ')
    .replace(/\{\{[^{}]*\}\}/g, ' ')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/'{2,5}/g, '')
    .replace(/\s+/g, ' ')).trim();
}

function pageTitle(urlText: string): string {
  const url = new URL(urlText);
  return decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) ?? url.hostname).replace(/_/g, ' ');
}

export async function readSourcePage(urlText: string, signal: AbortSignal): Promise<{ text: string; url: string; excerpted?: boolean }> {
  const url = validatePublicSourceUrl(urlText);
  if (url.pathname.startsWith('/wiki/')) {
    const api = new URL('/w/api.php', url.origin);
    api.searchParams.set('action', 'parse');
    api.searchParams.set('page', pageTitle(urlText));
    api.searchParams.set('prop', 'wikitext');
    api.searchParams.set('format', 'json');
    api.searchParams.set('formatversion', '2');
    let response: Awaited<ReturnType<typeof readPublicSource>>;
    try {
      response = await readPublicSource(api.toString(), signal);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'Source request failed (404)') throw error;
      api.pathname = '/api.php';
      response = await readPublicSource(api.toString(), signal);
    }
    const parsed: unknown = JSON.parse(response.text);
    const wikitext = parsed && typeof parsed === 'object' && 'parse' in parsed
      ? (parsed as { parse?: { wikitext?: unknown } }).parse?.wikitext : undefined;
    if (typeof wikitext !== 'string') throw new Error('Source page has no readable MediaWiki text');
    const text = plainSourceText(wikitext);
    return { url: urlText, text: text.slice(0, 50_000), excerpted: text.length > 50_000 };
  }
  const response = await readPublicSource(urlText, signal);
  const text = plainSourceText(response.text);
  return { url: response.url, text: text.slice(0, 50_000), excerpted: text.length > 50_000 };
}

export async function readStorySources(sources: readonly StorySource[], signal: AbortSignal,
  reader: typeof readSourcePage = readSourcePage, maxEvidenceBytes?: number): Promise<{ text: string; provenance: SourceRef[]; coverage: UnitRange[]; excerpted: boolean }> {
  if (sources.length > STORY_LIMITS.sourcePagesPerRun) throw new Error('Too many source pages for one research pass');
  const passages: string[] = [];
  const provenance: SourceRef[] = [];
  const admitted: UnitRange[] = [];
  let excerpted = false;
  for (const source of sources) {
    if (!source.confirmed) throw new Error('Unconfirmed source cannot be used as evidence');
    signal.throwIfAborted();
    const page = await reader(source.url, signal);
    signal.throwIfAborted();
    if (!page.text.trim()) throw new Error('A mapped source page is empty');
    const passage = `[${source.label ?? pageTitle(page.url)}; units ${source.from}-${source.to}]\n${page.text}`;
    const selected = maxEvidenceBytes === undefined ? { text: passage, excerpted: false }
      : sourceExcerpt(passage, Math.floor(maxEvidenceBytes / sources.length));
    passages.push(selected.text);
    excerpted ||= selected.excerpted || page.excerpted === true;
    if (!selected.excerpted && !page.excerpted) admitted.push({ from: source.from, to: source.to });
    provenance.push({ pageTitle: pageTitle(page.url), url: page.url, section: source.section, fetchedAt: Date.now() });
  }
  return { text: passages.join('\n\n'), provenance, coverage: normalizeProgress(admitted), excerpted };
}

export async function readCharacterEvidence(sourceUrl: string, name: string, sources: readonly StorySource[], signal: AbortSignal,
  options: { scope?: 'story'; reader?: typeof readSourcePage } = {}): Promise<CharacterEvidence> {
  const reader = options.reader ?? readSourcePage;
  if (options.scope === 'story') {
    const url = validatePublicSourceUrl(sourceUrl);
    const story = await readStorySources(sources, signal, reader, SCOPED_IDENTITY_EVIDENCE_BYTES);
    const quotes = [...story.text.matchAll(/[“"]([^“”"]{12,160})[”"]/gu)].map(match => match[1]).slice(0, 4);
    return { name, wikiUrl: url.origin, pageTitle: pageTitle(sourceUrl), pageUrl: sourceUrl,
      text: story.text, quotes, storyText: story.text, coverage: story.coverage, sources: story.provenance,
      excerpted: story.excerpted };
  }
  const identity = await reader(sourceUrl, signal);
  const identityExcerpt = sourceExcerpt(identity.text, IDENTITY_EVIDENCE_BYTES);
  const story = await readStorySources(sources, signal, reader, STORY_EVIDENCE_BYTES);
  const quotes = [...identityExcerpt.text.matchAll(/[“"]([^“”"]{12,160})[”"]/gu)].map(match => match[1]).slice(0, 4);
  return { name, wikiUrl: new URL(identity.url).origin, pageTitle: pageTitle(identity.url), pageUrl: identity.url,
    text: identityExcerpt.text, quotes, storyText: story.text, coverage: story.coverage,
    sources: [{ pageTitle: pageTitle(identity.url), url: identity.url, fetchedAt: Date.now() }, ...story.provenance],
    excerpted: identityExcerpt.excerpted || identity.excerpted === true || story.excerpted };
}
