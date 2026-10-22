import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createApp, openDatabase } from './database-helpers.mjs';
import { encryptSetting } from '../server/settings-crypto.mjs';

const script = fileURLToPath(new URL('../scripts/settings-key-from-legacy.mjs', import.meta.url));

// Oracle: deriveSettingsKey exactly as shipped before 49aacda.
function oldDeriveSettingsKey(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (/^[a-f0-9]{64}$/i.test(text)) return Buffer.from(text, 'hex');
  try {
    const decoded = Buffer.from(text, 'base64');
    if (decoded.length === 32) return decoded;
  } catch {}
  return createHash('sha256').update(text, 'utf8').digest();
}

function migrate(input) {
  const result = spawnSync(process.execPath, [script], { input, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr };
}

test('settings-key:migrate reproduces the old key derivation for every class of legacy value', () => {
  const base64Chars = randomBytes(32).toString('base64').slice(0, 43);
  const spacedBase64 = base64Chars.match(/.{1,5}/g).join(' ') + ' !';
  const inputs = ['AB'.repeat(32), spacedBase64, 'mật khẩu cũ của máy chủ', '  padded passphrase\n'];
  for (const input of inputs) {
    const { status, stdout } = migrate(input);
    assert.equal(status, 0, input);
    assert.match(stdout, /^[a-f0-9]{64}$/);
    assert.equal(stdout, oldDeriveSettingsKey(input).toString('hex'), input);
  }
  // The class the old SHA-256-only advice got wrong: decoded bytes, not a hash.
  const sha = createHash('sha256').update(spacedBase64.trim(), 'utf8').digest('hex');
  assert.notEqual(migrate(spacedBase64).stdout, sha);
  assert.equal(migrate(spacedBase64).stdout, Buffer.from(base64Chars, 'base64').toString('hex'));

  const empty = migrate('   ');
  assert.equal(empty.status, 1);
  assert.equal(empty.stdout, '');
  assert.match(empty.stderr, /settings-key:migrate/);
});

test('a migrated key opens settings encrypted under the old derivation; a mismatched key refuses to start', () => {
  const legacy = 'old shared passphrase for nhactoi';
  const db = openDatabase();
  db.prepare('INSERT INTO app_settings (key, value, encrypted, updated_at) VALUES (?, ?, 1, ?)')
    .run('smtp', encryptSetting('{"host":"smtp.test.local"}', oldDeriveSettingsKey(legacy)), new Date().toISOString());

  const key = migrate(legacy).stdout;
  const app = createApp({ db, env: { NODE_ENV: 'test', NHACTOI_SETTINGS_KEY: key } });
  assert.equal(app.locals.config._settingsKey.toString('hex'), key);
  app.locals.close();

  assert.throws(() => createApp({ db, env: { NODE_ENV: 'test', NHACTOI_SETTINGS_KEY: 'ee'.repeat(32) } }),
    /khóa mã hóa gốc không khớp dữ liệu đã mã hóa/);
});
