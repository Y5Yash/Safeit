import { GAZETTEER } from '../geo/gazetteer-data/index.js';
import { createFileGeoCache } from '../geo/file-cache.js';
import { buildMatcher, matchLocation, type Matcher } from '../geo/matcher.js';
import { createNominatim } from '../geo/nominatim.js';
import { resolveLocation } from '../geo/resolve.js';
import { CITIES, type City, type Geocode, type LocationInput, type ResolvedLocation } from '../types.js';

/** Runs calls one at a time, so concurrent callers can't race the Nominatim rate limiter. */
function serial<A extends unknown[], R>(fn: (...a: A) => Promise<R>): (...a: A) => Promise<R> {
  let tail: Promise<unknown> = Promise.resolve();
  return (...a) => {
    const run = tail.then(() => fn(...a));
    tail = run.catch(() => undefined);
    return run;
  };
}

/** Gazetteer matcher + cached Nominatim geocoder wired into resolveLocation. */
export function createResolver(cachePath: string): {
  resolve: (i: LocationInput) => Promise<ResolvedLocation>;
  flush: () => Promise<void>;
} {
  const cache = createFileGeoCache(cachePath);
  const geocode: Geocode = serial(createNominatim({ cache }).geocode);
  const matchers = Object.fromEntries(CITIES.map((c) => [c, buildMatcher(GAZETTEER[c] ?? [], c)])) as Record<City, Matcher>;
  return {
    resolve: (i) => resolveLocation(i, { match: (x) => matchLocation(matchers[x.city], x), geocode }),
    flush: () => cache.flush(),
  };
}
