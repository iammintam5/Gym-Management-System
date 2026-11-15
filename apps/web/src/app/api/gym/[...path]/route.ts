import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ path: string[] }> };

async function forward(
  request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  const { path } = await context.params;
  if (path.some((part) => !/^[a-zA-Z0-9_-]+$/.test(part)))
    return new Response('Invalid API path', { status: 400 });
  const configured =
    process.env.API_INTERNAL_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    'http://127.0.0.1:4000/api';
  const base = new URL(configured);
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.pathname.startsWith('/api/gym')
  )
    return new Response('Invalid API configuration', { status: 503 });
  const target = new URL(
    `${base.href.replace(/\/$/, '')}/${path.map(encodeURIComponent).join('/')}`,
  );
  target.search = request.nextUrl.search;
  const headers = new Headers();
  for (const name of ['authorization', 'content-type', 'accept']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const body = ['GET', 'HEAD'].includes(request.method)
    ? undefined
    : await request.arrayBuffer();
  if (body && body.byteLength > 2 * 1024 * 1024)
    return new Response('Request too large', { status: 413 });
  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body,
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(30000),
    });
    const payload = await upstream.arrayBuffer();
    const responseHeaders = new Headers({ 'Cache-Control': 'no-store' });
    const contentType = upstream.headers.get('content-type');
    if (contentType) responseHeaders.set('content-type', contentType);
    return new Response(payload, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    return Response.json(
      { message: 'Không thể kết nối máy chủ. Vui lòng thử lại.' },
      { status: 502 },
    );
  }
}

export {
  forward as GET,
  forward as POST,
  forward as PATCH,
  forward as PUT,
  forward as DELETE,
  forward as HEAD,
};
