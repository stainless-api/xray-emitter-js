import { createEmitter, getXrayContext } from '@stainlessdev/xray-emitter/next';
import { isMain } from '../_fetch_server';

export function createNextRoute(
  xray = createEmitter(
    {
      serviceName: 'xray-example',
      endpointUrl: process.env.STAINLESS_XRAY_ENDPOINT_URL,
    },
    { route: '/hello/:subject' },
  ),
) {
  const POST = xray(async (req, ctx) => {
    const params = await ctx.params;
    const subject = params.subject ?? 'world';
    const xrayCtx = getXrayContext(req);
    xrayCtx?.setActor('tenant-123', 'user-123');
    xrayCtx?.setAttribute('subject', subject);

    return new Response(JSON.stringify({ message: `Hello ${subject}` }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  return { POST };
}

if (isMain(import.meta.url)) {
  const xray = createEmitter(
    {
      serviceName: 'xray-example',
      endpointUrl: process.env.STAINLESS_XRAY_ENDPOINT_URL,
    },
    { route: '/hello/:subject' },
  );
  const handler = createNextRoute(xray).POST;
  const req = new Request('https://example.com/hello/test', {
    method: 'POST',
  });
  const ctx = { params: Promise.resolve({ subject: 'test' }) };
  void handler(req, ctx)
    .then(async (res) => {
      const text = await res.text();
      console.log(`response: ${res.status} ${text}`);
    })
    .then(() => xray.shutdown());
}
