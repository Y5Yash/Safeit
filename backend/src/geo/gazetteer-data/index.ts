import type { City, GazetteerEntry } from '../../types.js';
import bengaluru from './bengaluru.js';
import delhi from './delhi.js';
import goa from './goa.js';

export const GAZETTEER: Record<City, GazetteerEntry[]> = { delhi, bengaluru, goa };
