import * as cheerio from 'cheerio';
import type { Article, City, HttpResponse } from '../types.js';

const ARTICLE_TYPES = new Set(['NewsArticle', 'Article', 'ReportageNewsArticle', 'BlogPosting']);

function decode(s: string | undefined): string | undefined {
  if (s === undefined) return undefined;
  return cheerio.load(`<p>${s}</p>`)('p').text().trim();
}

function splitKeywords(k: unknown): string[] {
  if (Array.isArray(k)) return k.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof k === 'string') return k.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

function* walk(node: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(node)) { for (const n of node) yield* walk(n); return; }
  if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    yield o;
    if (o['@graph']) yield* walk(o['@graph']);
  }
}

export function parseJsonLdArticle(html: string) {
  const $ = cheerio.load(html);
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    let data: unknown;
    try { data = JSON.parse($(el).text()); } catch { continue; }
    for (const o of walk(data)) {
      const types = ([] as unknown[]).concat(o['@type'] ?? []).map(String);
      if (!types.some((t) => ARTICLE_TYPES.has(t))) continue;
      return {
        headline: decode(o.headline as string | undefined),
        datePublished: o.datePublished as string | undefined,
        description: decode(o.description as string | undefined),
        keywords: splitKeywords(o.keywords),
        articleBody: decode(o.articleBody as string | undefined),
      };
    }
  }
  return null;
}

export function parseMeta(html: string) {
  const $ = cheerio.load(html);
  const meta = (sel: string) => $(sel).attr('content')?.trim() || undefined;
  const paras = $('article p').toArray().map((p) => $(p).text().trim()).filter(Boolean);
  return {
    title: meta('meta[property="og:title"]') ?? ($('title').text().trim() || undefined),
    description: meta('meta[property="og:description"]') ?? meta('meta[name="description"]'),
    publishedTime: meta('meta[property="article:published_time"]'),
    keywords: splitKeywords(meta('meta[name="keywords"]') ?? meta('meta[name="news_keywords"]')),
    bodyText: paras.length ? paras.join('\n') : undefined,
  };
}

export function parseMarkdownArticle(md: string) {
  const title = md.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const description = md.split(/\n\s*\n/).map((p) => p.trim())
    .find((p) => p.length >= 80 && !p.startsWith('#') && !p.startsWith('!['));
  return { title, description, text: md };
}

export function htmlToText(html: string): string {
  const $ = cheerio.load(html);
  const blocks = $('p, li, h1, h2, h3, h4').toArray().map((e) => $(e).text().trim()).filter(Boolean);
  return blocks.length ? blocks.join('\n') : $.root().text().trim();
}

export function stripBoilerplate(text: string): string {
  const cut = text.search(/You Can Also Check:/i);
  return (cut >= 0 ? text.slice(0, cut) : text).trim();
}

function toDate(s: string | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function articleFromResponse(
  res: HttpResponse,
  ctx: { url: string; city: City; sourceName: string; fallbackTitle?: string; fallbackPublishedAt?: Date | null },
): Article | null {
  if (res.status !== 200 || !res.body) return null;
  let title: string | undefined;
  let publishedAt: Date | null = null;
  let description: string | null = null;
  let keywords: string[] = [];
  let text = '';
  if (res.format === 'markdown') {
    const md = parseMarkdownArticle(res.body);
    title = md.title ?? ctx.fallbackTitle;
    publishedAt = ctx.fallbackPublishedAt ?? null;
    description = md.description ?? null;
    text = md.text;
  } else {
    const ld = parseJsonLdArticle(res.body);
    const meta = parseMeta(res.body);
    title = ld?.headline ?? meta.title ?? ctx.fallbackTitle;
    publishedAt = toDate(ld?.datePublished) ?? toDate(meta.publishedTime) ?? ctx.fallbackPublishedAt ?? null;
    description = ld?.description ?? meta.description ?? null;
    keywords = ld?.keywords.length ? ld.keywords : meta.keywords;
    text = stripBoilerplate(ld?.articleBody ?? meta.bodyText ?? description ?? '');
  }
  if (!title || !publishedAt) return null;
  return { url: ctx.url, title, publishedAt, description, text, keywords, city: ctx.city, sourceName: ctx.sourceName };
}
