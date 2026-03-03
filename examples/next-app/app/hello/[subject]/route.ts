import { createEmitter, getXrayContext } from '@stainlessdev/xray-emitter/next';

const xray = createEmitter({
  serviceName: 'xray-example',
  endpointUrl: process.env.STAINLESS_XRAY_ENDPOINT_URL,
  requestId: { header: 'request-id' },
});

export const POST = xray(async (req, ctx) => {
  const params = await ctx.params;
  const subject = params.subject ?? 'world';
  const xrayCtx = getXrayContext(req);
  xrayCtx?.setActor('tenant-123', 'user-123');

  return new Response(JSON.stringify({ message: `Hello ${subject}` }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
});
