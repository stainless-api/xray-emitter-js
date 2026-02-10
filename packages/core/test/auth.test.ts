import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeConfig } from '../src/config';

test('exporter sends authorization header derived from endpointUrl', () => {
  const cfg = normalizeConfig({
    serviceName: 'test',
    endpointUrl: 'https://user:pass@collector.example.test',
    exporter: { spanProcessor: 'simple' },
  });

  const expected = Buffer.from('user:pass').toString('base64');
  assert.equal(cfg.exporter.endpointUrl, 'https://collector.example.test/v1/traces');
  assert.ok(cfg.exporter.headers);
  assert.equal(cfg.exporter.headers.Authorization, `Basic ${expected}`);
});

test('exporter decodes percent-encoded credentials in endpointUrl', () => {
  const cfg = normalizeConfig({
    serviceName: 'test',
    endpointUrl: 'https://user%40corp:pa%3Ass@collector.example.test',
    exporter: { spanProcessor: 'simple' },
  });

  const expected = Buffer.from('user@corp:pa:ss').toString('base64');
  assert.equal(cfg.exporter.endpointUrl, 'https://collector.example.test/v1/traces');
  assert.ok(cfg.exporter.headers);
  assert.equal(cfg.exporter.headers.Authorization, `Basic ${expected}`);
});

test('exporter decodes UTF-8 percent-encoded credentials in endpointUrl', () => {
  const cfg = normalizeConfig({
    serviceName: 'test',
    endpointUrl: 'https://m%C3%B6bius:p%C3%A4ss@collector.example.test',
    exporter: { spanProcessor: 'simple' },
  });

  const expected = Buffer.from('m\u00f6bius:p\u00e4ss', 'utf8').toString('base64');
  assert.equal(cfg.exporter.endpointUrl, 'https://collector.example.test/v1/traces');
  assert.ok(cfg.exporter.headers);
  assert.equal(cfg.exporter.headers.Authorization, `Basic ${expected}`);
});

test('exporter preserves invalid percent-encoded credentials in endpointUrl', () => {
  const cfg = normalizeConfig({
    serviceName: 'test',
    endpointUrl: 'https://%E0%A4:pass@collector.example.test',
    exporter: { spanProcessor: 'simple' },
  });

  const expected = Buffer.from('%E0%A4:pass', 'utf8').toString('base64');
  assert.equal(cfg.exporter.endpointUrl, 'https://collector.example.test/v1/traces');
  assert.ok(cfg.exporter.headers);
  assert.equal(cfg.exporter.headers.Authorization, `Basic ${expected}`);
});
