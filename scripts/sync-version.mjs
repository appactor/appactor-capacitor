// `npm version` runs this after bumping package.json, so the version sent to AppActor
// (src/version.ts) moves with it and lands in the same commit.
import { readFileSync, writeFileSync } from 'node:fs';
import { URL } from 'node:url';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const target = new URL('../src/version.ts', import.meta.url);
const source = readFileSync(target, 'utf8');
writeFileSync(target, source.replace(/appActorCapacitorVersion = '[^']*'/, `appActorCapacitorVersion = '${version}'`));
