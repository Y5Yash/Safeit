import type { SourceAdapter } from '../types.js';
import { dh } from './dh.js';
import { goemkarponn } from './goemkarponn.js';
import { ht } from './ht.js';
import { toi } from './toi.js';

export const ADAPTERS: SourceAdapter[] = [toi, ht, dh, goemkarponn];
