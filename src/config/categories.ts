/**
 * PROVISIONAL taxonomy derived from the ~100 hand-labelled news samples (research/sources/*_samples.json).
 * The user will replace it after eyeballing collected data — keep every category decision in this file.
 * Priority order: the first matching regex wins.
 */
export const CATEGORIES = [
  { id: 'sexual_crime', label: 'Sexual crime / harassment',
    re: /\b(rape[ds]?|raping|gang-?rape[ds]?|molest\w*|sexual(ly)? (assault|harass|abus)\w*|harass(ed|ment|ing)|stalk(ed|ing|er)|eve-?teas\w*|acid attack|voyeur\w*|pocso|obscene|indecent)\b/i },
  { id: 'road_accident', label: 'Road accident',
    re: /\b(accident|hit-and-run|hit and run|run over|mowed down|crash(ed|es)?|collid\w*|overturn\w*|rams?|rammed|skid(ded)?|drunk driving|mishap)\b/i },
  { id: 'murder', label: 'Murder',
    re: /\b(murder\w*|killed|kills?|hacked to death|stabbed to death|beaten to death|bludgeoned|shot dead|strangled|throttled|dead body|body (found|recovered)|homicide|lynch\w*)\b/i },
  { id: 'shooting', label: 'Shooting / firing',
    re: /\b(shot at|shoot\w*|firing|opened fire|gunshot|bullet)\b/i },
  { id: 'kidnapping', label: 'Kidnapping',
    re: /\b(kidnap\w*|abduct\w*|trafficking|ransom)\b/i },
  { id: 'cyber_fraud', label: 'Cyber fraud',
    re: /\b(cyber\w*|online (fraud|scam)|digital arrest|phishing|otp|upi|sextortion|investment (fraud|scam)|trading (fraud|scam)|fake (app|website|call cent(re|er))|deepfake|task scam|part-time job scam)\b/i },
  { id: 'robbery', label: 'Robbery / dacoity',
    re: /\b(robb(ed|ery|er|ers|ing)|robs?|loot\w*|dacoit\w*|mugg(ed|ing|er)|waylaid|at knifepoint|at gunpoint|heist|home invasion)\b/i },
  { id: 'snatching', label: 'Snatching',
    re: /\b(snatch\w*|chain-?snatch\w*)\b/i },
  { id: 'assault', label: 'Assault / attempt to murder',
    re: /\b(assault\w*|attack(ed|s)?|stab(bed|bing|s)?|attempt to murder|thrashed|beaten|brawl|clash(ed|es)?|injur(ed|es)|road rage|domestic violence)\b/i },
  { id: 'extortion_organised_crime', label: 'Extortion / organised crime',
    re: /\b(extort\w*|gang(ster|sters)?|arms act|illegal (arms|weapons?)|pistol|country-made|organised crime|mcoca|kcoca)\b/i },
  { id: 'fraud', label: 'Fraud / cheating',
    re: /\b(fraud\w*|cheat(ed|ing|s)?|dup(ed|ing)|scam\w*|conned|forg(ed|ery)|fake|swindl\w*|embezzl\w*|ponzi)\b/i },
  { id: 'drugs', label: 'Drugs / smuggling',
    re: /\b(drugs?|narcotic\w*|ndps|ganja|cannabis|charas|heroin|smack|cocaine|mdma|hashish|peddl\w*|psychotropic|lsd|mephedrone|smuggl\w*)\b/i },
  { id: 'burglary_theft', label: 'Burglary / theft',
    re: /\b(theft|thieves|thief|steal\w*|stole|stolen|burglar\w*|break into|break-in|broke into|house-?break\w*|pickpocket\w*|lifter)\b/i },
  { id: 'drowning', label: 'Drowning',
    re: /\b(drown\w*)\b/i },
  { id: 'unnatural_death', label: 'Unnatural death / suicide',
    re: /\b(suicide|found dead|unnatural death|found hanging|dies by suicide)\b/i },
  { id: 'public_safety', label: 'Public safety incident',
    re: /\b(collapse[ds]?|nuisance|stampede|electrocut\w*|fire breaks out|blaze)\b/i },
  { id: 'other', label: 'Other crime', re: null },
] as const satisfies readonly { id: string; label: string; re: RegExp | null }[];

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
