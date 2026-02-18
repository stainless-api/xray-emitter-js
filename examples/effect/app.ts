import { Effect } from 'effect';
import { HttpRouter, HttpServerResponse } from '@effect/platform';
import { createEmitter, currentXrayContext } from '@stainlessdev/xray-emitter/effect';

export const xray = createEmitter({
  serviceName: 'xray-example',
  endpointUrl: process.env.STAINLESS_XRAY_ENDPOINT_URL,
  // Read from response headers when finalized (default: Request-Id).
  requestId: { header: 'request-id' },
});

const router = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/',
    Effect.gen(function* () {
      const ctx = yield* currentXrayContext;
      ctx?.setActor('tenant-123', 'user-123');
      return HttpServerResponse.text('Hello Effect!');
    }),
  ),
  HttpRouter.post(
    '/widgets/:id',
    Effect.gen(function* () {
      const ctx = yield* currentXrayContext;
      ctx?.setAttribute('widget', true);
      return HttpServerResponse.text('created');
    }),
  ),
);

// Apply xray middleware
export const app = xray(router);
