import { createEmitter, wrapFetch } from '@stainlessdev/xray-emitter/fetch';
import { isMain } from '../_fetch_server';

export function createEdgeHandler(
  xray = createEmitter({
    serviceName: 'xray-example',
    endpointUrl: process.env.STAINLESS_XRAY_ENDPOINT_URL,
  }),
): (req: Request) => Promise<Response> {
  return wrapFetch(async (_req) => new Response('ok', { status: 200 }), xray);
}

if (isMain(import.meta.url)) {
  const xray = createEmitter({
    serviceName: 'xray-example',
    endpointUrl: process.env.STAINLESS_XRAY_ENDPOINT_URL,
  });
  const handler = createEdgeHandler(xray);
  const request = new Request('https://example.com/hello', { method: 'GET' });
  void handler(request)
    .then(async (res) => {
      const text = await res.text();
      console.log(`response: ${res.status} ${text}`);
    })
    .then(() => xray.shutdown());
}
