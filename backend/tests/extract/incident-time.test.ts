import { describe, expect, it } from 'vitest';
import { extractIncidentTime, istDate } from '../../src/extract/incident-time.js';

const ist = (s: string) => new Date(`${s}+05:30`);

describe('extractIncidentTime', () => {
  it('same weekday as publish day means that day', () => {
    // 2026-09-25 is a Friday
    expect(extractIncidentTime('The incident took place on Friday.', ist('2026-09-25T18:00:00')))
      .toEqual({ incidentAt: ist('2026-09-25T00:00:00'), precision: 'date' });
  });

  it('resolves earlier weekdays backwards', () => {
    // published Thursday 2026-09-24 → Tuesday 2026-09-22
    expect(extractIncidentTime('She was attacked on Tuesday night.', ist('2026-09-24T09:00:00')))
      .toEqual({ incidentAt: ist('2026-09-22T00:00:00'), precision: 'date' });
  });

  it('combines weekday with a clock time', () => {
    // published Wednesday 2026-09-23 → Monday 2026-09-21 23:30
    expect(extractIncidentTime('Around 11.30pm on Monday, two men on a bike...', ist('2026-09-23T08:00:00')))
      .toEqual({ incidentAt: ist('2026-09-21T23:30:00'), precision: 'exact' });
  });

  it('uses IST, not UTC, to find the publish weekday', () => {
    // 2026-09-25T20:00Z = Saturday 01:30 IST; "on Friday" → 2026-09-25
    expect(extractIncidentTime('It happened on Friday.', new Date('2026-09-25T20:00:00Z')).incidentAt)
      .toEqual(ist('2026-09-25T00:00:00'));
  });

  it('reads explicit dates, rolling back a year when needed', () => {
    expect(extractIncidentTime('The FIR says on September 11 the victim...', ist('2026-09-26T10:00:00')).incidentAt)
      .toEqual(ist('2026-09-11T00:00:00'));
    expect(extractIncidentTime('Police said on 30th December a gang...', ist('2026-01-02T10:00:00')).incidentAt)
      .toEqual(ist('2025-12-30T00:00:00'));
  });

  it('handles yesterday and 12 am', () => {
    expect(extractIncidentTime('The body was found yesterday at 12 am.', ist('2026-09-26T10:00:00')))
      .toEqual({ incidentAt: ist('2026-09-25T00:00:00'), precision: 'exact' });
  });

  it('returns unknown when there is no date phrase', () => {
    expect(extractIncidentTime('Police have registered a case.', ist('2026-09-26T10:00:00')))
      .toEqual({ incidentAt: null, precision: 'unknown' });
  });

  it('ignores text beyond the lead', () => {
    const text = 'Police registered a case. '.repeat(80) + 'on Monday';
    expect(extractIncidentTime(text, ist('2026-09-26T10:00:00')).precision).toBe('unknown');
  });
});

describe('intervening night (date_range)', () => {
  const pub = ist('2026-09-26T10:00:00');
  const range = (d: string) => ({ incidentAt: ist(`${d}T00:00:00`), precision: 'date_range' });

  it('uses the first date of a bare day pair, month/year from the publish date', () => {
    expect(extractIncidentTime('The theft happened on the intervening night of 20/21.', pub)).toEqual(range('2026-09-20'));
    expect(extractIncidentTime('on the intervening night of 20-21, burglars...', pub)).toEqual(range('2026-09-20'));
    expect(extractIncidentTime('during the intervening night of 20th/21st at 2 am', pub)).toEqual(range('2026-09-20'));
  });

  it('reads a month name after the pair', () => {
    expect(extractIncidentTime('on the intervening night of 20/21 September', pub)).toEqual(range('2026-09-20'));
    expect(extractIncidentTime('on the intervening night of 14-15 Aug', pub)).toEqual(range('2026-08-14'));
    expect(extractIncidentTime('on the intervening night of 30th/31st December', ist('2026-01-03T10:00:00')))
      .toEqual(range('2025-12-30'));
  });

  it('reads a numeric month and year', () => {
    expect(extractIncidentTime('on the intervening night of 20/21.09.2026', pub)).toEqual(range('2026-09-20'));
    expect(extractIncidentTime('on the intervening night of 3/4.07.2026', pub)).toEqual(range('2026-07-03'));
    expect(extractIncidentTime('intervening night of 31/1.12', ist('2026-01-05T10:00:00'))).toEqual(range('2025-12-31'));
  });

  it('rolls back a month (and year) when the bare pair would be in the future', () => {
    expect(extractIncidentTime('on the intervening night of 28/29', pub)).toEqual(range('2026-08-28'));
    expect(extractIncidentTime('on the intervening night of 30/31', ist('2026-01-02T10:00:00'))).toEqual(range('2025-12-30'));
  });

  it('bare "intervening night" without dates still means yesterday', () => {
    expect(extractIncidentTime('on the intervening night, thieves struck', pub))
      .toEqual({ incidentAt: ist('2026-09-25T00:00:00'), precision: 'date' });
  });
});

describe('istDate', () => {
  it('builds an IST wall-clock instant', () => {
    expect(istDate(2026, 8, 20, 23, 30).toISOString()).toBe('2026-09-20T18:00:00.000Z');
    expect(istDate(2026, 0, 1).toISOString()).toBe('2025-12-31T18:30:00.000Z');
  });
});
