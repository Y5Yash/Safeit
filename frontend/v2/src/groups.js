// User-facing groups for the v2 "Beware" map. Mirrors the backend table (see v2/CONTRACT.md) so the
// frontend works even before the backend starts sending `report.group`.
export const GROUPS = [
  { id: 'violent', label: 'Violent crime', color: '#e66767' },
  { id: 'harassment', label: 'Harassment', color: '#d55181' },
  { id: 'scam', label: 'Scam', color: '#d95926' },
  { id: 'transport', label: 'Transport', color: '#3987e5' },
  { id: 'stay', label: 'Stay', color: '#9085e9' },
  { id: 'safe', label: 'Safe', color: '#199e70', disabled: true },
];

export const GROUP_COLORS = Object.fromEntries(GROUPS.map((g) => [g.id, g.color]));

const BASE = {
  murder: 'violent',
  shooting: 'violent',
  sexual_crime: 'harassment',
  assault: 'harassment',
  robbery: 'harassment',
  snatching: 'harassment',
  kidnapping: 'harassment',
  extortion_organised_crime: 'harassment',
  fraud: 'scam',
  cyber_fraud: 'scam',
  road_accident: 'transport',
};

const STAY_RE = /\b(hotels?|resorts?|guest ?houses?|homestays?|hostels?|PGs?|paying guest|airbnb|lodges?|villas?|landlord|tenants?|accommodation|room rent|(flat|room|apartment|house) rental|booking (fraud|scam))\b/i;
const TRANSPORT_RE = /\b(taxis?|cabs?|auto(-| )?rickshaws?|auto drivers?|uber|ola|rapido|bike (rental|taxi)|rent-a-(bike|car)|touts?|bus (conductor|driver)|railway station|trains?|metro)\b/i;

/** Group id for a report: the backend's `group` when present (incl. null), else the local fallback. */
export function groupOf(r) {
  if (r.group !== undefined) return r.group;
  const base = BASE[r.category] ?? null;
  if (base !== 'scam' && base !== 'harassment') return base;
  const text = `${r.title || ''} ${r.description || ''}`;
  if (STAY_RE.test(text)) return 'stay';
  if (TRANSPORT_RE.test(text)) return 'transport';
  return base;
}
