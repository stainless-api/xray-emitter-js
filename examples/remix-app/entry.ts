import type { RequestHandler } from 'react-router';
import { createEmitter, getXrayContext } from '@stainlessdev/xray-emitter/remix';
import { isMain } from '../_fetch_server';

export function createRemixHandler(
  xray = createEmitter({
    serviceName: 'xray-example',
    endpointUrl: process.env.STAINLESS_XRAY_ENDPOINT_URL,
  }),
) {
  const handler: RequestHandler = async (request) => {
    const xrayCtx = getXrayContext(request);
    xrayCtx?.setUserId('user-123');
    const body = await request.text();
    return new Response(`remix:${body}`, { status: 200 });
  };

  return xray(handler);
}

if (isMain(import.meta.url)) {
  const handler = createRemixHandler();
  const req = new Request('https://example.com/hello', {
    method: 'POST',
    body: 'hello',
  });
  void handler(req, {}).then(async (res) => {
    const text = await res.text();
    console.log(`response: ${res.status} ${text}`);
  });
}
