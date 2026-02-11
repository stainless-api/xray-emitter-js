import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { decodeBase48Lex, encodeBase48Lex } from './base48';

const base48lex = '256789BCDFGHJKLMNPQRSTVWXYZbcdfghjklmnpqrstvwxyz';

const uuidVectors: Array<[string, string]> = [
  ['00000000-0000-0000-0000-000000000000', '22222222222222222222222'],
  ['00000000-0000-0000-0000-000000000001', '22222222222222222222225'],
  ['00000000-0000-0000-0000-000000000002', '22222222222222222222226'],
  ['00000000-0000-0000-0000-000000000007', '2222222222222222222222C'],
  ['00000000-0000-0000-0000-000000000008', '2222222222222222222222D'],
  ['00000000-0000-0000-0000-00000000000f', '2222222222222222222222M'],
  ['00000000-0000-0000-0000-000000000010', '2222222222222222222222N'],
  ['00000000-0000-0000-0000-00000000001f', '2222222222222222222222g'],
  ['00000000-0000-0000-0000-000000000020', '2222222222222222222222h'],
  ['00000000-0000-0000-0000-00000000003f', '2222222222222222222225M'],
  ['00000000-0000-0000-0000-000000000040', '2222222222222222222225N'],
  ['00000000-0000-0000-0000-00000000007f', '2222222222222222222226g'],
  ['00000000-0000-0000-0000-000000000080', '2222222222222222222226h'],
  ['00000000-0000-0000-0000-0000000000ff', '2222222222222222222229M'],
  ['00000000-0000-0000-0000-000000000100', '2222222222222222222229N'],
  ['00000000-0000-0000-0000-0000000001ff', '222222222222222222222Gg'],
  ['00000000-0000-0000-0000-000000000200', '222222222222222222222Gh'],
  ['00000000-0000-0000-0000-0000000003ff', '222222222222222222222TM'],
  ['00000000-0000-0000-0000-000000000400', '222222222222222222222TN'],
  ['00000000-0000-0000-0000-0000000007ff', '222222222222222222222tg'],
  ['00000000-0000-0000-0000-000000000800', '222222222222222222222th'],
  ['00000000-0000-0000-0000-000000000fff', '222222222222222222225nM'],
  ['00000000-0000-0000-0000-000000001000', '222222222222222222225nN'],
  ['00000000-0000-0000-0000-000000001fff', '222222222222222222227Zg'],
  ['00000000-0000-0000-0000-000000002000', '222222222222222222227Zh'],
  ['00000000-0000-0000-0000-000000003fff', '22222222222222222222C9M'],
  ['00000000-0000-0000-0000-000000004000', '22222222222222222222C9N'],
  ['00000000-0000-0000-0000-000000007fff', '22222222222222222222LGg'],
  ['00000000-0000-0000-0000-000000008000', '22222222222222222222LGh'],
  ['00000000-0000-0000-0000-00000000ffff', '22222222222222222222cTM'],
  ['00000000-0000-0000-0000-000000010000', '22222222222222222222cTN'],
  ['00000000-0000-0000-0000-0000ffffffff', '22222222222222222Ns8C9M'],
  ['00000000-0000-0000-0000-000100000000', '22222222222222222Ns8C9N'],
  ['00000000-0000-0000-0000-ffffffffffff', '22222222222222FzV2gd5nM'],
  ['00000000-0000-0000-0001-000000000000', '22222222222222FzV2gd5nN'],
  ['00000000-0000-0000-ffff-ffffffffffff', '222222222229w9wr6zKHJTM'],
  ['00000000-0000-0001-0000-000000000000', '222222222229w9wr6zKHJTN'],
  ['7fffffff-ffff-ffff-ffff-ffffffffffff', 'PXv9ffn8hqSMXZpzHqr8lZg'],
  ['80000000-0000-0000-0000-000000000000', 'PXv9ffn8hqSMXZpzHqr8lZh'],
  ['ffffffff-ffff-ffff-ffff-ffffffffffff', 'l5pHKKZFPfrg59dyWghFW9M'],
  ['00010203-0405-0607-0809-0a0b0c0d0e0f', '225HcN6WYccqQZvz6kPx7NM'],
  ['0f0e0d0c-0b0a-0908-0706-050403020100', '66vPLpQqBX5phMmrQTBZ7h2'],
  ['11111111-1111-1111-1111-111111111111', '6N9lxhvNdys9JsypLQ9NfNP'],
  ['22222222-2222-2222-2222-222222222222', '8hHWvPpjHxkGYlxccmGjJhk'],
  ['33333333-3333-3333-3333-333333333333', 'C2PHs6k5swbMpdwQvBN5v57'],
  ['44444444-4444-4444-4444-444444444444', 'FNVzpldQWvST7WvFFXTQYPS'],
  ['55555555-5555-5555-5555-555555555555', 'HhclmSXl9tKZNPszWtZlCjn'],
  ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'WPFWXs5VHmb8hllyzn9VMRZ'],
  ['deadbeef-dead-beef-dead-beefdeadbeef', 'fVtpPdb68S28t8rSgg6lRSz'],
  ['01234567-89ab-cdef-0123-456789abcdef', '2CVncfzj9FY2Szh8dnDfjZM'],
  ['fedcba98-7654-3210-fedc-ba9876543210', 'ktMThfZXJTMfc9xsstWZnb2'],
  ['4080c000-0000-4080-8000-000000000000', 'DqmCHvK8Q7FFBP5cSzBvrth'],
  ['00400000-4000-0040-0040-000040000000', '25fr65tqn86SsnKq9n7PDth'],
  ['00000000-4000-0040-0000-004000000000', '222222XxLBylV6D5brth222'],
  ['40800040-0000-0000-0000-000000408080', 'DqlGyCCtkd6HKJHtmbBwCD2'],
  ['80000040-0000-0000-0000-000000004000', 'PXv9jRph9Bd2Gf6P7dqjwTN'],
  ['40004080-0000-4000-0000-000000000000', 'DmTskPqxZtVRlD7tNvFKfGh'],
  ['00000000-0000-4079-c000-000000000000', '222222222tRTYZ5DSFGVXth'],
  ['00004080-0040-0000-0038-000000400000', '222Lv6TWt8M8RJSR6SxqjnN'],
  ['00000040-80c0-f940-0000-000000400038', '22226p7m9WhrqYBDX6gG7br'],
  ['00000040-0000-0000-0038-000000400040', '22226n5bSMDhkLtlXZtK5ph'],
];

const testCases: Array<[number[], string]> = [
  [[], ''],
  [[0], '22'],
  [[1], '25'],
  [[47], '2z'],
  [[48], '52'],
  [[255], '9M'],
  [[0, 0], '222'],
  [[0, 1], '225'],
  [[1, 0], '29N'],
  [[255, 255], 'cTM'],
  [[1, 2, 3], '22ch7'],
];

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '');
  assert.equal(hex.length, 32);
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) {
    const pair = hex.slice(i * 2, i * 2 + 2);
    bytes[i] = Number.parseInt(pair, 16);
  }
  return bytes;
}

test('encodeBase48Lex and decodeBase48Lex vectors', () => {
  for (const [input, expected] of testCases) {
    const bytes = Uint8Array.from(input);
    const encoded = encodeBase48Lex(bytes);
    assert.equal(encoded, expected);

    const decoded = decodeBase48Lex(expected);
    assert.deepEqual(Array.from(decoded), input);
  }
});

test('encodeBase48Lex compatibility vectors', () => {
  for (const [uuid, expected] of uuidVectors) {
    const bytes = uuidToBytes(uuid);
    const encoded = encodeBase48Lex(bytes);
    assert.equal(encoded, expected, `uuid ${uuid}`);
    assert.equal(encoded.length, 23);

    const decoded = decodeBase48Lex(expected);
    assert.deepEqual(Array.from(decoded), Array.from(bytes), `uuid ${uuid}`);
  }
});

test('encodeBase48Lex compatibility vectors are monotonic for increasing UUIDs', () => {
  const monotonic = uuidVectors.slice(0, 40);
  let prev = '';
  for (const [uuid] of monotonic) {
    const encoded = encodeBase48Lex(uuidToBytes(uuid));
    if (prev) {
      assert.ok(encoded > prev, `expected ${encoded} > ${prev}`);
    }
    prev = encoded;
  }
});

test('encodeBase48Lex and decodeBase48Lex random round-trip', () => {
  const lengths = [1, 2, 3, 4, 5, 8, 16, 32, 100];
  for (const length of lengths) {
    let encodedLength = 0;
    for (let i = 0; i < 1000; i += 1) {
      const input = randomBytes(length);
      const encoded = encodeBase48Lex(input);
      if (i === 0) {
        encodedLength = encoded.length;
      } else {
        assert.equal(encoded.length, encodedLength);
      }

      const decoded = decodeBase48Lex(encoded);
      assert.deepEqual(Array.from(decoded), Array.from(input));
    }
  }
});

test('encodeBase48Lex preserves lexicographic order for increasing values', () => {
  const bytes = new Uint8Array(16);
  let prev = '';
  for (let i = 0; i < 5000; i += 1) {
    bytes.fill(0);
    bytes[12] = (i >>> 24) & 0xff;
    bytes[13] = (i >>> 16) & 0xff;
    bytes[14] = (i >>> 8) & 0xff;
    bytes[15] = i & 0xff;
    const encoded = encodeBase48Lex(bytes);
    if (i > 0) {
      assert.ok(encoded > prev, `expected ${encoded} > ${prev}`);
    }
    prev = encoded;
  }
});

test('encodeBase48Lex lex order matches byte order for random values', () => {
  const samples = Array.from({ length: 200 }, () => randomBytes(16));
  const byBytes = [...samples].sort((a, b) => {
    for (let i = 0; i < a.length; i += 1) {
      const diff = (a[i] ?? 0) - (b[i] ?? 0);
      if (diff !== 0) {
        return diff;
      }
    }
    return 0;
  });

  const byEncoded = [...samples].sort((a, b) => {
    const encodedA = encodeBase48Lex(a);
    const encodedB = encodeBase48Lex(b);
    return encodedA < encodedB ? -1 : encodedA > encodedB ? 1 : 0;
  });

  for (let i = 0; i < byBytes.length; i += 1) {
    const left = byBytes[i];
    const right = byEncoded[i];
    assert.ok(left && right);
    assert.deepEqual(Array.from(left), Array.from(right));
  }
});

test('decodeBase48Lex rejects invalid input', () => {
  assert.throws(() => decodeBase48Lex('A'), /invalid string/);
  assert.throws(() => decodeBase48Lex('2'), /invalid length/);
});

test('encodeBase48Lex alphabet', () => {
  const encoded = encodeBase48Lex(randomBytes(32));
  for (const char of encoded) {
    assert.ok(base48lex.includes(char), `invalid base48 char: ${char}`);
  }
});
