import { pathToFileURL } from 'node:url';

export function isMain(importMetaUrl: string): boolean {
  const argv1 = process.argv[1];
  if (!argv1) {
    return false;
  }
  return importMetaUrl === pathToFileURL(argv1).href;
}
