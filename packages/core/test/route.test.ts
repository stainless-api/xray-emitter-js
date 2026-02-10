import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeRoutePattern } from '../src/route';

test('normalizeRoutePattern handles params and wildcards', () => {
  assert.equal(normalizeRoutePattern('/users/[id]'), '/users/{id}');
  assert.equal(normalizeRoutePattern('/users/{id}'), '/users/{id}');
  assert.equal(normalizeRoutePattern('/users/$id'), '/users/{id}');
  assert.equal(normalizeRoutePattern('/files/[...path]'), '/files/{path}');
  assert.equal(normalizeRoutePattern('/files/[...all]'), '/files/{all}');
  assert.equal(normalizeRoutePattern('/files/*'), '/files/{wildcard}');
});

test('normalizeRoutePattern trims query and fragment', () => {
  assert.equal(normalizeRoutePattern('/users/123?x=1#frag'), '/users/123');
});

test('normalizeRoutePattern strips method prefixes and express decorators', () => {
  assert.equal(normalizeRoutePattern('GET /users/:id(\\d+)'), '/users/{id}');
  assert.equal(normalizeRoutePattern('POST /widgets/:slug?'), '/widgets/{slug}');
  assert.equal(normalizeRoutePattern('DELETE /things/{thingId...}'), '/things/{thingId}');
});

test('normalizeRoutePattern defaults to /', () => {
  assert.equal(normalizeRoutePattern(''), '/');
  assert.equal(normalizeRoutePattern('   '), '/');
});
