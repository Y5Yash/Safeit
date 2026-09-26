import { describe, expect, it } from 'vitest';
import {
  articleFromResponse, htmlToText, parseJsonLdArticle, parseMarkdownArticle, parseMeta, stripBoilerplate,
} from '../../src/sources/parse-article.js';

const TOI_HTML = `<html><head>
<meta property="og:title" content="OG title">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage","name":"x"}</script>
<script type="application/ld+json">[{"@type":"NewsArticle","headline":"Man robbed &amp; stabbed in Shahdara",
"datePublished":"2026-09-12T09:30:00+05:30","description":"A 32-year-old was robbed.",
"keywords":"Shahdara robbery, Krishna Nagar, Delhi Police",
"articleBody":"NEW DELHI: A man was robbed on Thursday around 11.30pm. You Can Also Check: Gold Rate in Delhi"}]</script>
</head><body><p>para</p></body></html>`;

describe('parse-article', () => {
  it('reads NewsArticle JSON-LD from arrays and decodes entities', () => {
    const ld = parseJsonLdArticle(TOI_HTML)!;
    expect(ld.headline).toBe('Man robbed & stabbed in Shahdara');
    expect(ld.keywords).toEqual(['Shahdara robbery', 'Krishna Nagar', 'Delhi Police']);
    expect(ld.datePublished).toBe('2026-09-12T09:30:00+05:30');
  });

  it('reads @graph JSON-LD and array keywords', () => {
    const html = `<script type="application/ld+json">{"@graph":[{"@type":["ReportageNewsArticle"],"headline":"H","keywords":["a","b"]}]}</script>`;
    expect(parseJsonLdArticle(html)).toMatchObject({ headline: 'H', keywords: ['a', 'b'] });
  });

  it('survives invalid JSON-LD and falls back to meta tags', () => {
    const html = `<script type="application/ld+json">{bad json</script>
      <meta property="og:title" content="Meta title"><meta name="description" content="Meta desc">
      <meta property="article:published_time" content="2026-09-01T10:00:00+05:30">
      <meta name="keywords" content="a, b"><article><p>One.</p><p>Two.</p></article>`;
    expect(parseJsonLdArticle(html)).toBeNull();
    expect(parseMeta(html)).toEqual({
      title: 'Meta title', description: 'Meta desc', publishedTime: '2026-09-01T10:00:00+05:30',
      keywords: ['a', 'b'], bodyText: 'One.\nTwo.',
    });
  });

  it('parses Anakin markdown', () => {
    const md = '# Big headline\n\nshort\n\nThis is the first long paragraph of the article, which is more than eighty characters long.\n\nMore.';
    expect(parseMarkdownArticle(md)).toEqual({
      title: 'Big headline',
      description: 'This is the first long paragraph of the article, which is more than eighty characters long.',
      text: md,
    });
  });

  it('strips TOI boilerplate and converts html to text', () => {
    expect(stripBoilerplate('Body text. You Can Also Check: Gold Rate')).toBe('Body text.');
    expect(htmlToText('<p>A &amp; B</p><p>C</p>')).toBe('A & B\nC');
  });

  it('builds an Article from an HTML response', () => {
    const a = articleFromResponse(
      { status: 200, body: TOI_HTML, format: 'html', via: 'direct', headers: {} },
      { url: 'https://toi/x', city: 'delhi', sourceName: 'Times of India' })!;
    expect(a.title).toBe('Man robbed & stabbed in Shahdara');
    expect(a.publishedAt.toISOString()).toBe('2026-09-12T04:00:00.000Z');
    expect(a.text).toBe('NEW DELHI: A man was robbed on Thursday around 11.30pm.');
    expect(a).toMatchObject({ city: 'delhi', sourceName: 'Times of India', description: 'A 32-year-old was robbed.' });
  });

  it('builds an Article from markdown using fallbacks, and returns null without a date', () => {
    const md = { status: 200, body: '# T\n\nBody', format: 'markdown' as const, via: 'anakin' as const, headers: {} };
    const ctx = { url: 'u', city: 'goa' as const, sourceName: 'S' };
    expect(articleFromResponse(md, ctx)).toBeNull();
    expect(articleFromResponse(md, { ...ctx, fallbackPublishedAt: new Date('2026-09-01T00:00:00Z') })?.title).toBe('T');
    expect(articleFromResponse({ ...md, status: 404 }, ctx)).toBeNull();
  });
});
