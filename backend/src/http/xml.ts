import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, trimValues: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseXml(xml: string): any {
  return parser.parse(xml);
}

export function toArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}
