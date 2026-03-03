import { createEmitter, getXrayContext } from '@stainlessdev/xray-emitter/remix';
import { isMain } from '../_fetch_server';

export function createRemixHandler(
  xray = createEmitter({
    serviceName: 'xray-example',
    endpointUrl: process.env.STAINLESS_XRAY_ENDPOINT_URL,
  }),
) {
  const handler = async (request: Request) => {
    const xrayCtx = getXrayContext(request);
    xrayCtx?.setActor('tenant-123', 'user-123');

    const subject = new URL(request.url).pathname.split('/')[2] ?? 'world';
    xrayCtx?.setAttribute('subject', subject);

    return new Response(JSON.stringify({ message: `Hello ${subject}` }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  return xray(handler);
}

if (isMain(import.meta.url)) {
  const xray = createEmitter({
    serviceName: 'xray-example',
    endpointUrl: process.env.STAINLESS_XRAY_ENDPOINT_URL,
  });
  const handler = createRemixHandler(xray);
  const req = new Request('https://example.com/hello/test', {
    method: 'POST',
  });
  void (async () => {
    const res = await handler(req, {});
    const text = await res.text();
    console.log(`response: ${res.status} ${text}`);
    // Yield so the async body-capture in wrapFetchPreserve can finalize the
    // span before we shut down the tracer provider.
    await new Promise((r) => setTimeout(r, 10));
    await xray.shutdown();
  })();
}
