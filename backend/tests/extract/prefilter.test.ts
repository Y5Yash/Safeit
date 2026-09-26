import { describe, expect, it } from 'vitest';
import { prefilter } from '../../src/extract/prefilter.js';

describe('prefilter', () => {
  const url = 'https://x.com/a';
  it('keeps incident stories', () => {
    expect(prefilter({ title: 'Youth held for snatching phone in Rohini', url })).toBe(true);
    // drowning is a category now, so no arrest word is needed
    expect(prefilter({ title: '', url: 'https://toi/city/goa/tourist-drowns-at-baga/articleshow/1.cms' })).toBe(true);
    expect(prefilter({ title: 'Three arrested in Calangute', url })).toBe(true);
  });
  it('drops court, political and non-crime stories', () => {
    expect(prefilter({ title: 'HC grants bail to accused in 2024 murder case', url })).toBe(false);
    expect(prefilter({ title: 'Congress MLA slams govt over rising crime', url })).toBe(false);
    expect(prefilter({ title: 'Delhi weather: light rain likely today', url })).toBe(false);
  });
  it("drops 'other' stories without an arrest word", () => {
    expect(prefilter({ title: 'Police conduct flag march ahead of festival', url })).toBe(false);
    expect(prefilter({ title: 'Police conduct flag march, two detained', url })).toBe(true);
  });
  it('uses the URL slug when the title is empty', () => {
    expect(prefilter({ title: '', url: 'https://toi/city/delhi/man-stabbed-in-rohini/articleshow/1.cms' })).toBe(true);
    expect(prefilter({ title: '  ', url: 'https://www.hindustantimes.com/cities/delhi-news/woman-stabbed-in-tilak-nagar-101727000000000.html' })).toBe(true);
    expect(prefilter({ title: '', url: 'https://www.deccanherald.com/india/karnataka/bengaluru/city-gets-new-flyover-3712345' })).toBe(false);
  });
});
