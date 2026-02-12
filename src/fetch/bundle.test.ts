import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

test('fetch bundle does not include node http or xhr transports', async () => {
  const result = await build({
    entryPoints: [new URL('./fetch.ts', import.meta.url).pathname],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    metafile: true,
    conditions: ['browser', 'worker'],
    write: false,
    logLevel: 'silent',
  });

  assert.ok(result.outputFiles?.[0]?.text?.length, 'expected bundle output');
  const inputs = Object.keys(result.metafile?.inputs ?? {});
  const blocked = inputs.filter(
    (input) =>
      input.includes('node:http') ||
      input.includes('node:https') ||
      input.includes('platform/node'),
  );
  assert.deepEqual(blocked, []);
});
