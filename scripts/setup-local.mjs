import { existsSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
if (!existsSync('.dev.vars')) {
  writeFileSync(
    '.dev.vars',
    [
      'META_APP_SECRET',
      'META_WEBHOOK_VERIFY_TOKEN',
      'TOKEN_ENCRYPTION_KEY',
      'SESSION_SIGNING_SECRET',
    ]
      .map((k) => `${k}=${randomBytes(32).toString('base64')}`)
      .join('\n') + '\n',
  );
  console.log('Created local development keys in ignored .dev.vars.');
} else console.log('Using existing .dev.vars.');

const codespace = process.env.CODESPACE_NAME;
const forwardingDomain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
if (
  codespace &&
  forwardingDomain &&
  !/^MOCK_APP_ORIGINS=/m.test(readFileSync('.dev.vars', 'utf8'))
) {
  appendFileSync('.dev.vars', `MOCK_APP_ORIGINS=https://${codespace}-5173.${forwardingDomain}\n`);
  console.log('Allowed this Codespace’s forwarded web origin in local mock mode.');
}
