export type HeaderCapture = {
  headers: Record<string, string | string[]>;
  truncated: boolean;
};

export function headerValuesFromNodeHeaders(
  headers: Record<string, string | string[] | number | undefined>,
): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value == null) {
      continue;
    }
    const name = key.trim();
    if (!name) {
      continue;
    }
    if (Array.isArray(value)) {
      const entries = value.map((item) => `${item}`);
      if (entries.length > 0) {
        result[name] = entries.length === 1 ? entries[0]! : entries;
      }
    } else {
      result[name] = `${value}`;
    }
  }
  return Object.keys(result).length === 0 ? {} : result;
}

export function headerValuesFromFetchHeaders(headers: Headers): Record<string, string | string[]> {
  return headerValuesFromFetchHeadersWithLimit(headers, Number.POSITIVE_INFINITY).headers;
}

export function headerValuesFromFetchHeadersWithLimit(
  headers: Headers,
  maxBytes: number,
): HeaderCapture {
  const result: Record<string, string | string[]> = {};
  let truncated = false;
  let remaining = Number.isFinite(maxBytes) ? Math.max(0, maxBytes) : Number.POSITIVE_INFINITY;
  const setCookie = getSetCookie(headers);
  if (setCookie) {
    const values = takeHeaderValues('set-cookie', setCookie, remaining);
    remaining = values.remaining;
    if (values.truncated) {
      truncated = true;
    }
    if (values.values.length > 0) {
      result['set-cookie'] = values.values.length === 1 ? values.values[0]! : values.values;
    }
  }

  headers.forEach((value, key) => {
    const name = key.trim();
    if (!name) {
      return;
    }
    if (name.toLowerCase() === 'set-cookie' && setCookie) {
      return;
    }
    const values = takeHeaderValues(name, [value], remaining);
    remaining = values.remaining;
    if (values.truncated) {
      truncated = true;
    }
    if (values.values.length > 0) {
      result[name] = values.values.length === 1 ? values.values[0]! : values.values;
    }
  });

  return {
    headers: Object.keys(result).length === 0 ? {} : result,
    truncated,
  };
}

export function headerTokenList(values: string[] | string | undefined): string[] {
  if (!values) {
    return [];
  }
  if (Array.isArray(values)) {
    return splitTokens(values);
  }
  return splitTokens([values]);
}

function splitTokens(values: string[]): string[] {
  const tokens: string[] = [];
  for (const value of values) {
    if (!value) {
      continue;
    }
    for (const part of value.split(',')) {
      const trimmed = part.trim();
      if (trimmed) {
        tokens.push(trimmed);
      }
    }
  }
  return tokens;
}

function getSetCookie(headers: Headers): string[] | null {
  const maybe = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof maybe.getSetCookie === 'function') {
    const values = maybe.getSetCookie();
    return values.length > 0 ? values : null;
  }
  return null;
}

function takeHeaderValues(
  name: string,
  values: string[],
  remaining: number,
): { values: string[]; remaining: number; truncated: boolean } {
  if (remaining <= 0) {
    return { remaining: 0, truncated: true, values: [] };
  }

  const taken: string[] = [];
  let used = 0;
  for (const value of values) {
    if (!value) {
      continue;
    }
    const size = name.length + value.length;
    if (used + size > remaining) {
      return { remaining: Math.max(0, remaining - used), truncated: true, values: taken };
    }
    used += size;
    taken.push(value);
  }

  return { remaining: Math.max(0, remaining - used), truncated: false, values: taken };
}
