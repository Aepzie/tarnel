// Decides whether the release job signs, from which secrets are present. Never fails: missing or
// partial secrets just mean an unsigned build (partial sets are reported so they are easy to spot).
//
// Writes to $GITHUB_OUTPUT (or prints, when run locally):
//   signed=true|false   – whether electron-builder will sign on this runner
//   method=<name>       – azure | pfx | developer-id | none
//   notarize=true|false – macOS: all three Apple ID secrets are present
//   args=<cli args>     – extra electron-builder arguments ("--config <file>" for Windows signing)
//
// Windows signing options cannot live in electron-builder.yml: azureSignOptions there would make
// every build try Azure. Instead a small config that `extends` electron-builder.yml is written to
// the temp dir and passed with --config.

import { appendFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const env = (name) => process.env[name]?.trim() ?? '';
const missing = (names) => names.filter((name) => !env(name));

function windows() {
  const azure = [
    'AZURE_TENANT_ID',
    'AZURE_CLIENT_ID',
    'AZURE_CLIENT_SECRET',
    'AZURE_SIGNING_ENDPOINT',
    'AZURE_SIGNING_ACCOUNT',
    'AZURE_SIGNING_PROFILE',
    'WIN_PUBLISHER_NAME',
  ];
  const azureMissing = missing(azure);
  if (azureMissing.length === 0) {
    return {
      method: 'azure',
      win: {
        azureSignOptions: {
          publisherName: env('WIN_PUBLISHER_NAME'),
          endpoint: env('AZURE_SIGNING_ENDPOINT'),
          codeSigningAccountName: env('AZURE_SIGNING_ACCOUNT'),
          certificateProfileName: env('AZURE_SIGNING_PROFILE'),
        },
      },
    };
  }
  if (azureMissing.length < azure.length) {
    console.warn(`Azure Trusted Signing is partially configured; missing: ${azureMissing.join(', ')}`);
  }

  if (env('WIN_CSC_LINK')) {
    const publisherName = env('WIN_PUBLISHER_NAME');
    // Without an explicit name electron-builder takes the certificate's CN, which is what we want.
    return { method: 'pfx', win: publisherName ? { signtoolOptions: { publisherName } } : null };
  }
  return { method: 'none' };
}

function mac() {
  if (!env('CSC_LINK')) return { method: 'none' };
  const notarize = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'];
  const notarizeMissing = missing(notarize);
  if (notarizeMissing.length > 0) {
    // electron-builder throws on a partial Apple ID set, so the workflow only passes all three.
    console.warn(`Signing without notarization; missing: ${notarizeMissing.join(', ')}`);
    return { method: 'developer-id', notarize: false };
  }
  return { method: 'developer-id', notarize: true };
}

const platform = process.argv[2] ?? process.platform;
const result = platform === 'win32' ? windows() : platform === 'darwin' ? mac() : { method: 'none' };

let args = '';
if (result.win) {
  const file = join(process.env.RUNNER_TEMP || tmpdir(), 'electron-builder.signing.json');
  writeFileSync(file, JSON.stringify({ extends: 'electron-builder.yml', win: result.win }, null, 2));
  args = `--config "${file}"`;
}

const signed = result.method !== 'none';
console.log(`Code signing: ${signed ? result.method : 'off (unsigned build)'}`);
if (result.method === 'developer-id') console.log(`Notarization: ${result.notarize ? 'on' : 'off'}`);
const lines = [`signed=${signed}`, `method=${result.method}`, `notarize=${result.notarize === true}`, `args=${args}`];
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
else console.log(lines.join('\n'));
