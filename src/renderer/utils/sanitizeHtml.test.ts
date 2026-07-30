// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from './sanitizeHtml';

const pocWindow = window as unknown as Record<string, unknown>;

describe('sanitizeHtml', () => {
  it('strips onerror from img but keeps the element', () => {
    const out = sanitizeHtml('<img src=x onerror="window.__poc=1">');
    expect(out).not.toContain('onerror');
    expect(out).toContain('<img');
    expect(out).toContain('src="x"');
  });

  it('strips script tags entirely', () => {
    const out = sanitizeHtml('<p>hello</p><script>alert(1)</script>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert(1)');
    expect(out).toContain('hello');
  });

  it('strips iframes', () => {
    const out = sanitizeHtml('<iframe src="https://evil.example"></iframe><p>safe</p>');
    expect(out).not.toContain('<iframe');
    expect(out).not.toContain('evil.example');
    expect(out).toContain('safe');
  });

  it('strips javascript: hrefs but keeps link text', () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('>x</a>');
  });

  it('preserves ruby/rt, b, i, and span class/style (flashcard fidelity)', () => {
    const out = sanitizeHtml(
      '<ruby>漢<rt>かん</rt></ruby><b>bold</b><i>ital</i><span class="x" style="color:red">s</span>',
    );
    expect(out).toContain('<ruby>漢<rt>かん</rt></ruby>');
    expect(out).toContain('<b>bold</b>');
    expect(out).toContain('<i>ital</i>');
    expect(out).toContain('class="x"');
    expect(out).toContain('style="color:red"');
  });

  it('preserves tables', () => {
    const out = sanitizeHtml('<table><tr><td>x</td></tr></table>');
    expect(out).toContain('<table>');
    expect(out).toContain('<td>x</td>');
  });

  it('preserves flashcard-image:// src', () => {
    const out = sanitizeHtml('<img src="flashcard-image://abc123.png">');
    expect(out).toContain('src="flashcard-image://abc123.png"');
  });

  it('preserves flashcard-audio:// src', () => {
    const out = sanitizeHtml('<audio src="flashcard-audio://abc123.mp3"></audio>');
    expect(out).toContain('src="flashcard-audio://abc123.mp3"');
  });

  it('preserves local-media:// src', () => {
    const out = sanitizeHtml('<video src="local-media://xyz.mp4"></video>');
    expect(out).toContain('src="local-media://xyz.mp4"');
  });

  it('preserves https and relative hrefs', () => {
    const abs = sanitizeHtml('<a href="https://example.com">e</a>');
    const rel = sanitizeHtml('<a href="/path">p</a>');
    expect(abs).toContain('href="https://example.com"');
    expect(rel).toContain('href="/path"');
  });

  it('preserves data: image src on img', () => {
    const out = sanitizeHtml('<img src="data:image/png;base64,iVBORw0KGgo=">');
    expect(out).toContain('src="data:image/png;base64,iVBORw0KGgo="');
  });

  it('neutralizes svg onload and nested script payloads', () => {
    const svg = sanitizeHtml('<svg onload=alert(1)></svg>');
    expect(svg).not.toContain('onload');
    expect(svg).not.toContain('alert');

    const nested = sanitizeHtml('<math><mtext><script>alert(1)</script><img src=x onerror=alert(2)></mtext></math>');
    expect(nested).not.toContain('<script');
    expect(nested).not.toContain('onerror');
  });

  it('PoC: sanitized onerror payload never executes when assigned to innerHTML', async () => {
    const payload = '<img src=x onerror="window.__xss_poc_fired=true">';
    const el = document.createElement('div');
    el.innerHTML = sanitizeHtml(payload);
    document.body.appendChild(el);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(pocWindow.__xss_poc_fired).toBeUndefined();
    el.remove();
  });
});
