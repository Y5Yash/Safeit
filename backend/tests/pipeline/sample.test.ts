import { describe, expect, it } from 'vitest';
import { sampleEvenly } from '../../src/pipeline/sample.js';

describe('sampleEvenly', () => {
  const id = (n: number) => n;
  it('returns everything (sorted by time) when there are at most n items', () => {
    expect(sampleEvenly([3, 1, 2], 5, id)).toEqual([1, 2, 3]);
    expect(sampleEvenly([3, 1, 2], 3, id)).toEqual([1, 2, 3]);
  });
  it('picks n evenly spaced items including both ends', () => {
    const items = Array.from({ length: 101 }, (_, i) => 100 - i);
    expect(sampleEvenly(items, 5, id)).toEqual([0, 25, 50, 75, 100]);
  });
  it('never returns duplicates and handles n = 1 and n = 0', () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    const out = sampleEvenly(items, 7, id);
    expect(new Set(out).size).toBe(7);
    expect(sampleEvenly(items, 1, id)).toHaveLength(1);
    expect(sampleEvenly(items, 0, id)).toEqual([]);
  });
  it('does not mutate the input', () => {
    const items = [3, 1, 2, 5, 4];
    sampleEvenly(items, 2, id);
    expect(items).toEqual([3, 1, 2, 5, 4]);
  });
});
