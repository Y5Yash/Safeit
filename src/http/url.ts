export function canonicalUrl(url: string): string {
  const u = new URL(url);
  u.protocol = 'https:';
  u.hostname = u.hostname.toLowerCase();
  u.search = '';
  u.hash = '';
  let s = u.toString();
  if (u.pathname !== '/' && s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

export function slugToTitle(url: string): string {
  const segs = new URL(url).pathname.split('/').filter(Boolean);
  const idx = segs.indexOf('articleshow');
  const seg = idx > 0 ? segs[idx - 1] : segs.filter((s) => s.includes('-')).sort((a, b) => b.length - a.length)[0] ?? '';
  return decodeURIComponent(seg)
    .replace(/\.(html?|cms)$/i, '')
    .replace(/-\d{5,}$/, '')
    .replace(/-/g, ' ')
    .trim();
}
