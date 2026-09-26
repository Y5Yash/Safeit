import { CITIES, type City } from '../types.js';

export interface CityConfig {
  displayName: string;
  aliases: string[];
  center: { lat: number; lng: number };
  bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number };
}

export const CITY_CONFIG: Record<City, CityConfig> = {
  delhi: {
    displayName: 'Delhi',
    aliases: ['delhi', 'new delhi'],
    center: { lat: 28.6139, lng: 77.209 },
    bbox: { minLat: 28.4, maxLat: 28.89, minLng: 76.83, maxLng: 77.35 },
  },
  bengaluru: {
    displayName: 'Bengaluru',
    aliases: ['bengaluru', 'bangalore'],
    center: { lat: 12.9716, lng: 77.5946 },
    bbox: { minLat: 12.8, maxLat: 13.2, minLng: 77.4, maxLng: 77.85 },
  },
  goa: {
    displayName: 'Goa',
    aliases: ['goa'],
    center: { lat: 15.4909, lng: 73.8278 },
    bbox: { minLat: 14.89, maxLat: 15.81, minLng: 73.66, maxLng: 74.34 },
  },
};

export function inCity(city: City, lat: number, lng: number): boolean {
  const b = CITY_CONFIG[city].bbox;
  return lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;
}

export function isCity(v: unknown): v is City {
  return typeof v === 'string' && (CITIES as readonly string[]).includes(v);
}
