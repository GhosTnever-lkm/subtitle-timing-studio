import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export function validateReleaseTag(tag, shippedVersion, packageVersion) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag ?? '')) {
    throw new Error(`Release tag must use vMAJOR.MINOR.PATCH; received ${JSON.stringify(tag)}`);
  }
  if (!shippedVersion || shippedVersion !== packageVersion) {
    throw new Error(`VERSION (${shippedVersion || 'missing'}) must match package.json (${packageVersion || 'missing'})`);
  }
  if (tag !== `v${shippedVersion}`) {
    throw new Error(`Release tag ${tag} does not match shipped version v${shippedVersion}`);
  }
}

async function main() {
  const tag = process.argv[2];
  const root = new URL('../', import.meta.url);
  const shippedVersion = (await readFile(new URL('VERSION', root), 'utf8')).trim();
  const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  validateReleaseTag(tag, shippedVersion, packageJson.version);
  process.stdout.write(`Validated release tag ${tag}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
