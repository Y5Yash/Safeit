import { describe, expect, it } from 'vitest';
import { scrubPii } from '../../src/extract/pii.js';

describe('scrubPii', () => {
  it('removes relation clauses up to the next comma/full stop/semicolon', () => {
    expect(scrubPii('The accused, Ramesh Kumar s/o Suresh Kumar, was arrested.'))
      .toBe('The accused, Ramesh Kumar, was arrested.');
    expect(scrubPii('The victim is Sunita D/O Late Mohan Lal. Police registered a case.'))
      .toBe('The victim is Sunita. Police registered a case.');
    expect(scrubPii('Complainant Asha w/o Rajesh; she said the chain was snatched'))
      .toBe('Complainant Asha; she said the chain was snatched');
    expect(scrubPii('Arrested: Ali R/o Seelampur, Delhi')).toBe('Arrested: Ali, Delhi');
    expect(scrubPii('Held: Amit s/o R. K. Sharma, a driver')).toBe('Held: Amit, a driver');
  });

  it('removes ages', () => {
    expect(scrubPii('A 32-year-old woman was attacked in Rohini.')).toBe('A woman was attacked in Rohini.');
    expect(scrubPii('The man, aged 45, was held.')).toBe('The man, was held.');
  });

  it('removes house numbers', () => {
    expect(scrubPii('Burglars broke into H.No. 123, Sector 7, Rohini')).toBe('Burglars broke into, Sector 7, Rohini');
    expect(scrubPii('Fire at H No 12/4 in Laxmi Nagar')).toBe('Fire at in Laxmi Nagar');
    expect(scrubPii('Theft reported at house no. 5B near the market')).toBe('Theft reported at near the market');
  });

  it('handles several kinds together and collapses whitespace', () => {
    expect(scrubPii('Rahul   s/o  Vijay, 24-year-old,  r/o H.No. 7, Karol Bagh was nabbed.'))
      .toBe('Rahul, Karol Bagh was nabbed.');
  });

  it('keeps ordinary text intact', () => {
    const s = 'Two men on a bike snatched a phone near Hauz Khas metro station on Monday.';
    expect(scrubPii(s)).toBe(s);
    expect(scrubPii('Phone no. 1 seller held; 5 years of jail')).toBe('Phone no. 1 seller held; 5 years of jail');
  });
});

describe('scrubPii word-number ages', () => {
  it('removes ages written as words', () => {
    expect(scrubPii('a man sexually assaulted a three-year-old girl in Rohini')).toBe('a man sexually assaulted a girl in Rohini');
    expect(scrubPii('killed a five-year-old boy, aged twenty-two')).not.toMatch(/year-old|twenty/);
  });
});
