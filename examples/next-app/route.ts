import { createEmitter, getXrayContext } from '@stainlessdev/xray-emitter/next';
import { isMain } from '../_fetch_server';

export function createNextRoute(
  xray = createEmitter({
    serviceName: 'xray-example',
    endpointUrl: process.env.STAINLESS_XRAY_ENDPOINT_URL,
  }),
) {
  const POST = xray(async (req, ctx) => {
    const params = await ctx.params;
    const body = await req.text();
    const xrayCtx = getXrayContext(req);
    xrayCtx?.setUserId('user-123');

    return new Response(`next:${params.id ?? ''}:${body}`, { status: 200 });
  });

  return { POST };
}

if (isMain(import.meta.url)) {
  const xray = createEmitter({
    serviceName: 'xray-example',
    endpointUrl: process.env.STAINLESS_XRAY_ENDPOINT_URL,
  });
  const handler = createNextRoute(xray).POST;
  const req = new Request('https://example.com/widgets/123', {
    method: 'POST',
    body: 'hello',
  });
  const ctx = { params: Promise.resolve({ id: '123' }) };
  void handler(req, ctx)
    .then(async (res) => {
      const text = await res.text();
      console.log(`response: ${res.status} ${text}`);
    })
    .then(() => xray.shutdown());
}
