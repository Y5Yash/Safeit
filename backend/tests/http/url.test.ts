import { describe, expect, it } from 'vitest';
import { canonicalUrl, slugToTitle } from '../../src/http/url.js';

describe('canonicalUrl', () => {
  it('forces https, lowercases host, drops query/hash and trailing slash', () => {
    expect(canonicalUrl('http://WWW.Example.com/a/b/?utm_source=x#top')).toBe('https://www.example.com/a/b');
    expect(canonicalUrl('https://example.com/')).toBe('https://example.com/');
  });
});

describe('slugToTitle', () => {
  it('reads TOI, HT and DH slugs', () => {
    expect(slugToTitle('https://timesofindia.indiatimes.com/city/delhi/man-robbed-at-knifepoint-in-shahdara/articleshow/123456789.cms'))
      .toBe('man robbed at knifepoint in shahdara');
    expect(slugToTitle('https://www.hindustantimes.com/cities/delhi-news/woman-stabbed-in-tilak-nagar-101727000000000.html'))
      .toBe('woman stabbed in tilak nagar');
    expect(slugToTitle('https://www.deccanherald.com/india/karnataka/bengaluru/chain-snatcher-held-3712345'))
      .toBe('chain snatcher held');
  });
});
