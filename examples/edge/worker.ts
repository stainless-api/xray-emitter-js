import { createEmitter, wrapFetch, getXrayContext } from '@stainlessdev/xray-emitter/fetch';
import { isMain } from '../_fetch_server';

export function createEdgeHandler(
  xray = createEmitter({
    serviceName: 'xray-example',
    endpointUrl: process.env.STAINLESS_XRAY_ENDPOINT_URL,
  }),
): (req: Request) => Promise<Response> {
  return wrapFetch(async (req) => {
    const ctx = getXrayContext(req);
    ctx?.setActor('tenant-123', 'user-123');

    const subject = new URL(req.url).pathname.split('/')[2] ?? 'world';
    ctx?.setAttribute('subject', subject);

    return new Response(JSON.stringify({ message: `Hello ${subject}` }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }, xray);
}

if (isMain(import.meta.url)) {
  const xray = createEmitter({
    serviceName: 'xray-example',
    endpointUrl: process.env.STAINLESS_XRAY_ENDPOINT_URL,
  });
  const handler = createEdgeHandler(xray);
  const request = new Request('https://example.com/hello/test', { method: 'POST' });
  void handler(request)
    .then(async (res) => {
      const text = await res.text();
      console.log(`response: ${res.status} ${text}`);
    })
    .then(() => xray.shutdown());
}
