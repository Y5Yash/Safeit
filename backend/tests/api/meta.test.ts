import { describe, expect, it } from 'vitest';
import { handleMeta } from '../../src/api/meta.js';
import { CATEGORIES, GROUPS } from '../../src/config/categories.js';
import { rep } from './fixtures.js';

describe('GET /api/meta', () => {
  it('returns cities, categories, per-source counts and date range', async () => {
    const rows = [
      rep({ published_datetime: '2026-09-01T10:00:00+05:30' }),
      rep({ published_datetime: '2026-09-20T10:00:00+05:30' }),
      rep({ city: 'goa', source_name: 'Goemkarponn' }),
      rep({ source_name: 'Delhi Police', source_type: 'police_fir_list', incident_datetime: '2026-08-15T10:00:00+05:30' }),
    ];
    const m = await handleMeta(new Request('https://app/api/meta'), rows).json();
    expect(m.cities.map((c: { id: string }) => c.id)).toEqual(['delhi', 'bengaluru', 'goa']);
    expect(m.cities[0]).toMatchObject({ name: 'Delhi', center: { lat: 28.6139, lng: 77.209 } });
    expect(m.categories).toEqual(CATEGORIES.map(({ id, label }) => ({ id, label })));
    expect(m.groups.map((g: { id: string }) => g.id)).toEqual(['violent', 'harassment', 'scam', 'transport', 'stay', 'safe']);
    expect(m.groups[0]).toEqual({ id: 'violent', label: 'Violent crime', color: '#e66767' });
    expect(m.groups[5]).toEqual({ id: 'safe', label: 'Safe', color: '#199e70', disabled: true });
    expect(m.groups).toHaveLength(GROUPS.length);
    expect(m.sources).toEqual([
      { city: 'delhi', source_name: 'Delhi Police', source_type: 'police_fir_list', count: 1 },
      { city: 'delhi', source_name: 'TOI', source_type: 'news', count: 2 },
      { city: 'goa', source_name: 'Goemkarponn', source_type: 'news', count: 1 },
    ]);
    expect(m.date_range).toEqual({
      min: new Date('2026-08-15T10:00:00+05:30').toISOString(),
      max: new Date('2026-09-20T10:00:00+05:30').toISOString(),
    });
  });

  it('returns a null date range when empty', async () => {
    expect((await handleMeta(new Request('https://app/api/meta'), []).json()).date_range).toBeNull();
  });
});
