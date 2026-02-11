import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const version = process.argv[2];
if (!version) {
  console.error('Usage: node scripts/release.js <version>');
  process.exit(1);
}

const pkgPath = join(process.cwd(), 'package.json');
const raw = readFileSync(pkgPath, 'utf8');
const pkg = JSON.parse(raw);
pkg.version = version;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

console.log(`Updated package to version ${version}.`);
