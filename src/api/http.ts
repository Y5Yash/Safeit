const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization',
};

export function json(data: unknown, status = 200, cache = true): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cache && status === 200 ? 's-maxage=300, stale-while-revalidate=600' : 'no-store',
      ...CORS,
    },
  });
}

export const badRequest = (msg: string): Response => json({ error: msg }, 400, false);
export const preflight = (): Response => new Response(null, { status: 204, headers: CORS });
