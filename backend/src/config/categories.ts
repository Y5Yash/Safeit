/**
 * PROVISIONAL taxonomy derived from the ~100 hand-labelled news samples (research/sources/*_samples.json).
 * The user will replace it after eyeballing collected data — keep every category decision in this file.
 * Priority order: the first matching regex wins.
 */
/** User-facing groups (frontend/v2/CONTRACT.md), in display order. `safe` has no rule yet ("coming soon"). */
export const GROUP_IDS = ['violent', 'harassment', 'scam', 'transport', 'stay', 'safe'] as const;
export type GroupId = (typeof GROUP_IDS)[number];
export interface Group { id: GroupId; label: string; color: string; disabled?: boolean }

export const GROUPS: readonly Group[] = [
  { id: 'violent', label: 'Violent crime', color: '#e66767' },
  { id: 'harassment', label: 'Harassment', color: '#d55181' },
  { id: 'scam', label: 'Scam', color: '#d95926' },
  { id: 'transport', label: 'Transport', color: '#3987e5' },
  { id: 'stay', label: 'Stay', color: '#9085e9' },
  { id: 'safe', label: 'Safe', color: '#199e70', disabled: true },
];

export const CATEGORIES = [
  { id: 'sexual_crime', group: 'harassment', label: 'Sexual crime / harassment',
    re: /\b(rape[ds]?|raping|gang-?rape[ds]?|molest\w*|sexual(ly)? (assault|harass|abus)\w*|harass(ed|ment|ing)|stalk(ed|ing|er)|eve-?teas\w*|acid attack|voyeur\w*|pocso|obscene|indecent)\b/i },
  { id: 'road_accident', group: 'transport', label: 'Road accident',
    re: /\b(accident|hit-and-run|hit and run|run over|mowed down|crash(ed|es)?|collid\w*|overturn\w*|rams?|rammed|skid(ded)?|drunk driving|mishap)\b/i },
  { id: 'murder', group: 'violent', label: 'Murder',
    re: /\b(murder\w*|killed|kills?|hacked to death|stabbed to death|beaten to death|bludgeoned|shot dead|strangled|throttled|dead body|body (found|recovered)|homicide|lynch\w*)\b/i },
  { id: 'shooting', group: 'violent', label: 'Shooting / firing',
    re: /\b(shot at|shoot\w*|firing|opened fire|gunshot|bullet)\b/i },
  { id: 'kidnapping', group: 'harassment', label: 'Kidnapping',
    re: /\b(kidnap\w*|abduct\w*|trafficking|ransom)\b/i },
  { id: 'cyber_fraud', group: 'scam', label: 'Cyber fraud',
    re: /\b(cyber\w*|online (fraud|scam)|digital arrest|phishing|otp|upi|sextortion|investment (fraud|scam)|trading (fraud|scam)|fake (app|website|call cent(re|er))|deepfake|task scam|part-time job scam)\b/i },
  { id: 'robbery', group: 'harassment', label: 'Robbery / dacoity',
    re: /\b(robb(ed|ery|er|ers|ing)|robs?|loot\w*|dacoit\w*|mugg(ed|ing|er)|waylaid|at knifepoint|at gunpoint|heist|home invasion)\b/i },
  { id: 'snatching', group: 'harassment', label: 'Snatching',
    re: /\b(snatch\w*|chain-?snatch\w*)\b/i },
  { id: 'assault', group: 'harassment', label: 'Assault / attempt to murder',
    re: /\b(assault\w*|attack(ed|s)?|stab(bed|bing|s)?|attempt to murder|thrashed|beaten|brawl|clash(ed|es)?|injur(ed|es)|road rage|domestic violence)\b/i },
  { id: 'extortion_organised_crime', group: 'harassment', label: 'Extortion / organised crime',
    re: /\b(extort\w*|gang(ster|sters)?|arms act|illegal (arms|weapons?)|pistol|country-made|organised crime|mcoca|kcoca)\b/i },
  { id: 'fraud', group: 'scam', label: 'Fraud / cheating',
    re: /\b(fraud\w*|cheat(ed|ing|s)?|dup(ed|ing)|scam\w*|conned|forg(ed|ery)|fake|swindl\w*|embezzl\w*|ponzi)\b/i },
  { id: 'drugs', group: null, label: 'Drugs / smuggling',
    re: /\b(drugs?|narcotic\w*|ndps|ganja|cannabis|charas|heroin|smack|cocaine|mdma|hashish|peddl\w*|psychotropic|lsd|mephedrone|smuggl\w*)\b/i },
  { id: 'burglary_theft', group: null, label: 'Burglary / theft',
    re: /\b(theft|thieves|thief|steal\w*|stole|stolen|burglar\w*|break into|break-in|broke into|house-?break\w*|pickpocket\w*|lifter)\b/i },
  { id: 'drowning', group: null, label: 'Drowning',
    re: /\b(drown\w*)\b/i },
  { id: 'unnatural_death', group: null, label: 'Unnatural death / suicide',
    re: /\b(suicide|found dead|unnatural death|found hanging|dies by suicide)\b/i },
  { id: 'public_safety', group: null, label: 'Public safety incident',
    re: /\b(collapse[ds]?|nuisance|stampede|electrocut\w*|fire breaks out|blaze)\b/i },
  { id: 'other', group: null, label: 'Other crime', re: null },
] as const satisfies readonly { id: string; group: GroupId | null; label: string; re: RegExp | null }[];

export type CategoryId = (typeof CATEGORIES)[number]['id'];
export const CATEGORY_IDS: CategoryId[] = CATEGORIES.map((c) => c.id);

export function classify(text: string): CategoryId {
  for (const c of CATEGORIES) if (c.re && c.re.test(text)) return c.id;
  return 'other';
}

/** The source phrase that decided the category (stored as category_raw), or null. */
export function classifyRaw(text: string): string | null {
  for (const c of CATEGORIES) {
    const m = c.re ? text.match(c.re) : null;
    if (m) return m[0].toLowerCase();
  }
  return null;
}

const STAY_RE =
  /\b(hotels?|resorts?|guest ?houses?|homestays?|hostels?|PGs?|paying guest|airbnb|lodges?|villas?|landlord|tenants?|accommodation|room rent|(flat|room|apartment|house) rental|booking (fraud|scam))\b/i;
const TRANSPORT_RE =
  /\b(taxis?|cabs?|auto(-| )?rickshaws?|auto drivers?|uber|ola|rapido|bike (rental|taxi)|rent-a-(bike|car)|touts?|bus (conductor|driver)|railway station|trains?|metro)\b/i;

const BASE_GROUP = new Map<string, GroupId | null>(CATEGORIES.map((c) => [c.id, c.group]));

/** Derived user-facing group. Keyword overrides (stay, then transport) apply only to scam/harassment. */
export function groupOf(r: { category: string; title: string; description: string | null }): GroupId | null {
  const base = BASE_GROUP.get(r.category) ?? null;
  if (base !== 'scam' && base !== 'harassment') return base;
  const text = `${r.title} ${r.description ?? ''}`;
  if (STAY_RE.test(text)) return 'stay';
  if (TRANSPORT_RE.test(text)) return 'transport';
  return base;
}
