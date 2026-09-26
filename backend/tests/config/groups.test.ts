import { describe, expect, it } from 'vitest';
import { CATEGORIES, GROUPS, groupOf } from '../../src/config/categories.js';

const base = (category: string) => groupOf({ category, title: 'Incident reported', description: null });

describe('GROUPS', () => {
  it('lists the 6 user-facing groups in order with colours; safe is disabled', () => {
    expect(GROUPS.map((g) => [g.id, g.label, g.color])).toEqual([
      ['violent', 'Violent crime', '#e66767'],
      ['harassment', 'Harassment', '#d55181'],
      ['scam', 'Scam', '#d95926'],
      ['transport', 'Transport', '#3987e5'],
      ['stay', 'Stay', '#9085e9'],
      ['safe', 'Safe', '#199e70'],
    ]);
    expect(GROUPS.find((g) => g.id === 'safe')?.disabled).toBe(true);
    expect(GROUPS.filter((g) => g.disabled).map((g) => g.id)).toEqual(['safe']);
  });
});

describe('groupOf', () => {
  it('maps every category to its base group', () => {
    const expected: Record<string, string | null> = {
      murder: 'violent', shooting: 'violent',
      sexual_crime: 'harassment', assault: 'harassment', robbery: 'harassment', snatching: 'harassment',
      kidnapping: 'harassment', extortion_organised_crime: 'harassment',
      fraud: 'scam', cyber_fraud: 'scam',
      road_accident: 'transport',
      burglary_theft: null, drugs: null, drowning: null, unnatural_death: null, public_safety: null, other: null,
    };
    expect(Object.keys(expected).sort()).toEqual(CATEGORIES.map((c) => c.id).sort());
    for (const c of CATEGORIES) {
      expect(c.group).toBe(expected[c.id]);
      expect(base(c.id)).toBe(expected[c.id]);
    }
  });

  it('overrides harassment → stay on accommodation keywords', () => {
    expect(groupOf({ category: 'sexual_crime', title: 'Bengaluru landlord arrested for molesting tenant', description: null })).toBe('stay');
    expect(groupOf({ category: 'robbery', title: 'Guests robbed', description: 'at a homestay in Anjuna' })).toBe('stay');
  });

  it('overrides scam → transport on transport keywords', () => {
    expect(groupOf({ category: 'fraud', title: 'Tourists duped by fake taxi touts at airport', description: null })).toBe('transport');
    expect(groupOf({ category: 'assault', title: 'Auto-rickshaw driver thrashes passenger', description: null })).toBe('transport');
  });

  it('checks stay before transport', () => {
    expect(groupOf({ category: 'fraud', title: 'Hotel booking scam via cab driver', description: null })).toBe('stay');
  });

  it('scam → stay for booking fraud', () => {
    expect(groupOf({ category: 'cyber_fraud', title: 'Woman loses Rs 2 lakh in booking fraud', description: null })).toBe('stay');
  });

  it('does not override violent, transport or excluded groups', () => {
    expect(groupOf({ category: 'murder', title: 'Man shot dead in Rohini', description: 'near a hotel' })).toBe('violent');
    expect(groupOf({ category: 'road_accident', title: 'Car rams hotel wall', description: null })).toBe('transport');
    expect(groupOf({ category: 'burglary_theft', title: 'Theft at hotel room', description: 'taxi' })).toBeNull();
  });

  it('respects word boundaries', () => {
    expect(groupOf({ category: 'fraud', title: 'Scam in Cabinet ministry', description: 'hotelier' })).toBe('scam');
  });

  it('returns null for an unknown category', () => {
    expect(base('nope')).toBeNull();
  });
});
