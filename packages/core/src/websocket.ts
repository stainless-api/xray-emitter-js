import { headerTokenList } from './headers';

type HeaderValues = Record<string, string | string[]>;

export function isWebsocketUpgrade(
  statusCode: number,
  requestHeaders: HeaderValues | undefined,
  responseHeaders: HeaderValues | undefined,
): boolean {
  if (statusCode !== 101) {
    return false;
  }

  if (headerHasToken(responseHeaders, 'upgrade', 'websocket')) {
    return true;
  }
  return headerHasToken(requestHeaders, 'upgrade', 'websocket');
}

export function isWebsocketUpgradeFetch(
  statusCode: number,
  requestHeaders: Headers,
  responseHeaders: Headers,
): boolean {
  if (statusCode !== 101) {
    return false;
  }

  if (headerHasTokenFetch(responseHeaders, 'upgrade', 'websocket')) {
    return true;
  }
  return headerHasTokenFetch(requestHeaders, 'upgrade', 'websocket');
}

function headerHasToken(headers: HeaderValues | undefined, name: string, token: string): boolean {
  if (!headers) {
    return false;
  }
  const values = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  if (!values) {
    return false;
  }
  const tokens = headerTokenList(values);
  return tokens.some((value) => value.toLowerCase() === token.toLowerCase());
}

function headerHasTokenFetch(headers: Headers, name: string, token: string): boolean {
  const value = headers.get(name);
  if (!value) {
    return false;
  }
  return value.split(',').some((part) => part.trim().toLowerCase() === token.toLowerCase());
}
