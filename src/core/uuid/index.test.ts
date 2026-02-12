import assert from 'node:assert/strict';
import test from 'node:test';
import { generateRequestId, uuidv7, uuidv7base48, uuidv7base62 } from './index';

test('uuidv7 format and version bits', () => {
  const id = uuidv7();
  assert.equal(id.length, 36);
  assert.equal(id.charAt(14), '7');
  const variant = id.charAt(19);
  assert.ok(['8', '9', 'a', 'b'].includes(variant));
});

test('uuidv7base62 length and alphabet', () => {
  const id = uuidv7base62();
  assert.equal(id.length, 22);
  assert.ok(/^[0-9A-Za-z]+$/.test(id));
});

test('uuidv7base48 length and alphabet', () => {
  const id = uuidv7base48();
  assert.equal(id.length, 23);
  assert.ok(/^[256789BCDFGHJKLMNPQRSTVWXYZbcdfghjklmnpqrstvwxyz]+$/.test(id));
});

test('generateRequestId uses prefix', () => {
  const id = generateRequestId();
  assert.ok(id.startsWith('req_'));
  assert.equal(id.length, 27);
  assert.ok(/^req_[256789BCDFGHJKLMNPQRSTVWXYZbcdfghjklmnpqrstvwxyz]+$/.test(id));
});
