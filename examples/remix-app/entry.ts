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
    xrayCtx?.setUserId('user-123');
    const body = await request.text();
    return new Response(`remix:${body}`, { status: 200 });
  };

  return xray(handler);
}

if (isMain(import.meta.url)) {
  const xray = createEmitter({
    serviceName: 'xray-example',
    endpointUrl: process.env.STAINLESS_XRAY_ENDPOINT_URL,
  });
  const handler = createRemixHandler(xray);
  const req = new Request('https://example.com/hello', {
    method: 'POST',
    body: 'hello',
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
