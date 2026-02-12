import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeConfig } from './config';

const envKeys = ['STAINLESS_XRAY_ENDPOINT_URL'] as const;

function withEnv(vars: Partial<Record<(typeof envKeys)[number], string>>, fn: () => void): void {
  const previous: Partial<Record<(typeof envKeys)[number], string | undefined>> = {};
  for (const key of envKeys) {
    previous[key] = process.env[key];
    const next = vars[key];
    if (next === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = next;
    }
  }

  try {
    fn();
  } finally {
    for (const key of envKeys) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test('normalizeConfig throws when no endpointUrl is configured', () => {
  withEnv({}, () => {
    assert.throws(() => normalizeConfig({ serviceName: 'test' }), /endpointUrl is required/i);
  });
});

test('normalizeConfig uses STAINLESS_XRAY_ENDPOINT_URL env var as fallback', () => {
  withEnv(
    {
      STAINLESS_XRAY_ENDPOINT_URL: 'http://stainless-collector:4318',
    },
    () => {
      const cfg = normalizeConfig({ serviceName: 'test' });
      assert.equal(cfg.exporter.endpointUrl, 'http://stainless-collector:4318/v1/traces');
    },
  );
});

test('normalizeConfig prefers explicit endpointUrl over STAINLESS_XRAY_ENDPOINT_URL', () => {
  withEnv(
    {
      STAINLESS_XRAY_ENDPOINT_URL: 'http://stainless-collector:4318',
    },
    () => {
      const cfg = normalizeConfig({
        serviceName: 'test',
        endpointUrl: 'https://explicit.example.test',
      });
      assert.equal(cfg.exporter.endpointUrl, 'https://explicit.example.test/v1/traces');
    },
  );
});

test('normalizeConfig preserves explicit traces path', () => {
  const cfg = normalizeConfig({
    serviceName: 'test',
    endpointUrl: 'https://collector.example.test/v1/traces',
  });
  assert.equal(cfg.exporter.endpointUrl, 'https://collector.example.test/v1/traces');
});

test('normalizeConfig extracts basic auth from endpointUrl', () => {
  const cfg = normalizeConfig({
    serviceName: 'test',
    endpointUrl: 'https://user:pass@collector.example.test',
  });
  const expected = Buffer.from('user:pass').toString('base64');
  assert.equal(cfg.exporter.endpointUrl, 'https://collector.example.test/v1/traces');
  assert.ok(cfg.exporter.headers);
  assert.equal(cfg.exporter.headers.Authorization, `Basic ${expected}`);
});

test('normalizeConfig preserves explicit authorization header', () => {
  const cfg = normalizeConfig({
    serviceName: 'test',
    endpointUrl: 'https://user:pass@collector.example.test',
    exporter: {
      headers: { Authorization: 'Bearer token' },
    },
  });
  assert.equal(cfg.exporter.endpointUrl, 'https://collector.example.test/v1/traces');
  assert.ok(cfg.exporter.headers);
  assert.equal(cfg.exporter.headers.Authorization, 'Bearer token');
});

test('normalizeConfig enables body capture by default', () => {
  const cfg = normalizeConfig({
    serviceName: 'test',
    endpointUrl: 'https://collector.example.test',
  });
  assert.equal(cfg.capture.requestBody, 'text');
  assert.equal(cfg.capture.responseBody, 'text');
});
