const headerNameCompactor = /[-_.]/g;
const headerTokenSplitter = /[-_.]/;

type HeaderRedactionMatcher = {
  exactSensitive: Set<string>;
  keywordTokens: Set<string>;
  keywordCompacted: string[];
};

const defaultHeaderMatcher = newHeaderRedactionMatcher(
  defaultSensitiveHeaderNames(),
  defaultSensitiveKeywords(),
);

export function authSchemePrefix(value: string): string {
  if (!value) {
    return '';
  }

  const lower = value.toLowerCase();
  if (lower.startsWith('basic')) {
    return value.slice(0, 'basic'.length);
  }
  if (lower.startsWith('bearer')) {
    return value.slice(0, 'bearer'.length);
  }
  if (lower.startsWith('digest')) {
    return value.slice(0, 'digest'.length);
  }
  if (lower.startsWith('negotiate')) {
    return value.slice(0, 'negotiate'.length);
  }
  return '';
}

export function redactCookieValue(value: string, replacement: string): string {
  if (!value) {
    return replacement;
  }

  const parts = value.split(';');
  const redacted: string[] = [];

  for (const part of parts) {
    const segment = part.trim();
    if (!segment) {
      redacted.push(replacement);
      continue;
    }
    const idx = segment.indexOf('=');
    if (idx <= 0) {
      redacted.push(replacement);
      continue;
    }
    const name = segment.slice(0, idx);
    if (!name) {
      redacted.push(replacement);
      continue;
    }
    redacted.push(`${name}=${replacement}`);
  }

  return redacted.join('; ');
}

export function redactSetCookieValue(value: string, replacement: string): string {
  if (!value) {
    return replacement;
  }

  const parts = value.split(';');
  const first = parts.shift() ?? '';
  const idx = first.indexOf('=');
  if (idx <= 0) {
    return replacement;
  }
  const name = first.slice(0, idx);
  if (!name) {
    return replacement;
  }

  const redacted = `${name}=${replacement}`;
  if (parts.length === 0) {
    return redacted;
  }
  return `${redacted};${parts.join(';')}`;
}

export function isSensitiveHeaderName(key: string): boolean {
  return isSensitiveNormalized(defaultHeaderMatcher, normalizeHeaderName(key));
}

function addSensitiveHeaderNames(target: Set<string>, headers: string[]): void {
  for (const header of headers) {
    const normalized = normalizeHeaderName(header);
    if (normalized) {
      target.add(normalized);
    }
  }
}

function buildKeywordSets(keywords: string[]): { compacted: string[]; tokens: Set<string> } {
  const tokens = new Set<string>();
  const compacted = new Set<string>();

  for (const keyword of keywords) {
    const normalized = normalizeHeaderName(keyword);
    if (!normalized) {
      continue;
    }
    const compactedKeyword = compactNormalizedHeaderName(normalized);
    if (compactedKeyword) {
      compacted.add(compactedKeyword);
    }
    if (!normalized.includes('-') && !normalized.includes('_') && !normalized.includes('.')) {
      tokens.add(normalized);
    }
  }

  return {
    compacted: Array.from(compacted).sort(),
    tokens,
  };
}

function compactNormalizedHeaderName(normalized: string): string {
  if (!normalized) {
    return '';
  }
  return normalized.replace(headerNameCompactor, '');
}

function defaultSensitiveHeaderNames(): string[] {
  return [
    'authorization',
    'cookie',
    'proxy-authenticate',
    'proxy-authorization',
    'set-cookie',
    'www-authenticate',
  ];
}

function defaultSensitiveKeywords(): string[] {
  return [
    'api-key',
    'api_key',
    'apikey',
    'auth',
    'authenticate',
    'authorization',
    'credential',
    'password',
    'passwd',
    'private-key',
    'private_key',
    'privatekey',
    'secret',
    'session',
    'sessionid',
    'signature',
    'token',
  ];
}

function headerNameTokens(name: string): string[] {
  if (!name) {
    return [];
  }
  return name.split(headerTokenSplitter).filter(Boolean);
}

function hasKeywordToken(tokens: string[], keywordTokens: Set<string>): boolean {
  for (const token of tokens) {
    if (keywordTokens.has(token)) {
      return true;
    }
  }
  return false;
}

function isExactMatch(normalized: string, exactSensitive: Set<string>): boolean {
  return exactSensitive.has(normalized);
}

function isSensitiveNormalized(matcher: HeaderRedactionMatcher, normalized: string): boolean {
  if (!normalized) {
    return false;
  }
  if (isExactMatch(normalized, matcher.exactSensitive)) {
    return true;
  }
  if (hasKeywordToken(headerNameTokens(normalized), matcher.keywordTokens)) {
    return true;
  }
  return matchesCompacted(normalized, matcher.keywordCompacted);
}

function matchesCompacted(normalized: string, keywordCompacted: string[]): boolean {
  if (keywordCompacted.length === 0) {
    return false;
  }
  const compacted = compactNormalizedHeaderName(normalized);
  if (!compacted) {
    return false;
  }
  return keywordCompacted.some((keyword) => compacted.includes(keyword));
}

function newHeaderRedactionMatcher(names: string[], keywords: string[]): HeaderRedactionMatcher {
  const exactSensitive = new Set<string>();
  addSensitiveHeaderNames(exactSensitive, names);
  const { compacted, tokens } = buildKeywordSets(keywords);
  return {
    exactSensitive,
    keywordCompacted: compacted,
    keywordTokens: tokens,
  };
}

function normalizeHeaderName(name: string): string {
  return name.trim().toLowerCase();
}
