import type { CategoryId } from './config/categories.js';

export type { CategoryId };

export const CITIES = ['delhi', 'bengaluru', 'goa'] as const;
export type City = (typeof CITIES)[number];

/** Matches merge_plan.md §2 so police-session rows merge without mapping. */
export const SOURCE_TYPES = ['news', 'police_press_release', 'police_fir_list', 'police_detection_report'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export type GeoPrecision = 'address' | 'police_station' | 'locality' | 'city';
export type IncidentPrecision = 'exact' | 'date' | 'date_range' | 'unknown';

/** One stored record (a "mention"). Serialized as-is into data/reports.json. Dates are ISO-8601 strings. */
export interface Report {
  id: string;
  event_id: string;
  city: City;
  title: string;
  category: CategoryId;
  category_raw: string | null;
  source_name: string;
  source_type: SourceType;
  source_link: string;
  incident_datetime: string | null;
  incident_datetime_precision: IncidentPrecision;
  published_datetime: string;
  location_text: string | null;
  police_station: string | null;
  lat: number;
  lng: number;
  geo_precision: GeoPrecision;
  description: string | null;
}

export interface HttpResponse {
  status: number;
  body: string;
  format: 'html' | 'markdown' | 'json' | 'xml';
  via: 'direct' | 'anakin';
  headers: Record<string, string>;
}
export interface HttpGetOptions {
  accept?: 'html' | 'json' | 'xml';
  allowFallback?: boolean;
}
export interface Http {
  get(url: string, opts?: HttpGetOptions): Promise<HttpResponse>;
}

/** Parsed article. `text` is used for extraction only and is never stored. */
export interface Article {
  url: string;
  title: string;
  publishedAt: Date;
  description: string | null;
  text: string;
  keywords: string[];
  city: City;
  sourceName: string;
}

export interface Candidate {
  url: string;
  title: string;
  publishedAt: Date | null;
  city: City;
  /** Set when discovery already returned the full article (e.g. WordPress API). */
  article?: Article;
}

export interface DiscoverOptions {
  mode: 'live' | 'backfill';
  since: Date;
  until: Date;
}

export interface SourceAdapter {
  id: string;
  name: string;
  cities: City[];
  discover(opts: DiscoverOptions, http: Http): Promise<Candidate[]>;
  fetchArticle(c: Candidate, http: Http): Promise<Article | null>;
}

export interface GazetteerEntry {
  name: string;
  kind: 'police_station' | 'locality';
  lat: number;
  lng: number;
}

export interface LocationInput {
  city: City;
  title: string;
  keywords: string[];
  text: string;
  location_text?: string | null;
  lat?: number | null;
  lng?: number | null;
}

export interface LocationMatch {
  text: string;
  lat: number;
  lng: number;
  precision: 'police_station' | 'locality';
}

export interface ResolvedLocation {
  location_text: string | null;
  police_station: string | null;
  lat: number;
  lng: number;
  geo_precision: GeoPrecision;
  in_area: boolean;
}

export interface GeoCacheValue {
  lat: number | null;
  lng: number | null;
  display_name: string | null;
}
export interface GeoCache {
  get(key: string): Promise<GeoCacheValue | undefined>;
  set(key: string, v: GeoCacheValue): Promise<void>;
}
export type Geocode = (
  query: string,
  city: City,
) => Promise<{ lat: number; lng: number; display_name: string } | null>;

export interface IncidentTime {
  incidentAt: Date | null;
  precision: IncidentPrecision;
}
