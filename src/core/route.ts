export function normalizeRoutePattern(route: string): string {
  if (!route) {
    return '/';
  }

  const cleaned = stripQueryAndFragment(route).trim();
  if (!cleaned) {
    return '/';
  }

  const withoutMethod = stripMethodPrefix(cleaned);
  const leading = withoutMethod.startsWith('/') ? withoutMethod : `/${withoutMethod}`;
  const segments = leading.split('/').filter(Boolean);
  if (segments.length === 0) {
    return '/';
  }

  const normalized = segments.map(normalizeRouteSegment).join('/');
  return `/${normalized}`;
}

function stripMethodPrefix(value: string): string {
  if (!/^[A-Z]+\s+\//.test(value)) {
    return value;
  }
  const spaceIndex = value.search(/\s+/);
  if (spaceIndex < 0) {
    return value;
  }
  return value.slice(spaceIndex).trim();
}

function stripQueryAndFragment(value: string): string {
  const hashIndex = value.indexOf('#');
  const beforeHash = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
  const queryIndex = beforeHash.indexOf('?');
  return queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash;
}

function normalizeRouteSegment(segment: string): string {
  if (segment === '*') {
    return '{wildcard}';
  }

  const param = extractRouteParam(segment);
  if (param) {
    return `{${param}}`;
  }

  return segment;
}

function extractRouteParam(segment: string): string | null {
  if (!segment) {
    return null;
  }

  if (segment.startsWith('[') && segment.endsWith(']')) {
    return normalizeNextParam(segment);
  }

  if (segment.startsWith('{') && segment.endsWith('}')) {
    const inner = segment.slice(1, -1);
    const trimmed = stripParamDecorators(inner);
    return extractParamName(trimmed);
  }

  if (segment.startsWith(':') || segment.startsWith('$')) {
    return extractParamName(segment.slice(1));
  }

  return null;
}

function normalizeNextParam(segment: string): string | null {
  let inner = segment.slice(1, -1);
  if (inner.startsWith('[') && inner.endsWith(']')) {
    inner = inner.slice(1, -1);
  }
  if (inner.startsWith('...')) {
    inner = inner.slice(3);
  }
  return extractParamName(inner);
}

function stripParamDecorators(value: string): string {
  let trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (trimmed.endsWith('...')) {
    trimmed = trimmed.slice(0, -3);
  }
  return trimmed.replace(/[?*+]+$/, '');
}

function extractParamName(value: string): string | null {
  if (!value) {
    return null;
  }
  const match = value.match(/^[A-Za-z0-9_-]+/);
  return match?.[0] ?? null;
}
