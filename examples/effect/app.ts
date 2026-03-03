import { Effect } from 'effect';
import { HttpRouter, HttpServerResponse } from '@effect/platform';
import { createEmitter, currentXrayContext } from '@stainlessdev/xray-emitter/effect';

export const xray = createEmitter({
  serviceName: 'xray-example',
  endpointUrl: process.env.STAINLESS_XRAY_ENDPOINT_URL,
  // Read from response headers when finalized (default: Request-Id).
  requestId: { header: 'request-id' },
});

const setActor = Effect.gen(function* () {
  const ctx = yield* currentXrayContext;
  ctx?.setActor('tenant-123', 'user-123');
});

export const app = HttpRouter.empty.pipe(
  HttpRouter.post(
    '/hello/:subject',
    Effect.gen(function* () {
      yield* setActor;
      const params = yield* HttpRouter.params;
      const subject = params.subject ?? 'world';
      return HttpServerResponse.text(JSON.stringify({ message: `Hello ${subject}` }), {
        contentType: 'application/json',
      });
    }),
  ),
  HttpRouter.use(xray),
);
