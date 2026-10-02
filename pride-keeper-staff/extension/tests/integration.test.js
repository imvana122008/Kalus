const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('manifest loads registry and runtime in dependency order on the forum only', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const scripts = manifest.content_scripts?.[0]?.js || [];
  assert.equal(manifest.version, '5.0.0');
  assert.deepEqual(manifest.host_permissions, ['https://forum.pridekeeper.tech/*']);
  assert.deepEqual(manifest.content_scripts?.[0]?.matches, ['https://forum.pridekeeper.tech/*']);
  assert.deepEqual(scripts, [
    'src/bootstrap.js', 'src/context.js', 'src/action-registry.js', 'src/store.js', 'src/history.js',
    'src/complaints.js', 'src/preferences.js', 'src/actions.js', 'src/replies.js',
    'src/productivity.js', 'src/inline-toolbar.js', 'src/staff-gate.js', 'src/staff.js', 'src/panel.js', 'src/runtime.js'
  ]);
});

test('all runtime components identify as the same v5.0 release', () => {
  assert.match(read('src/bootstrap.js'), /version:\s*'5\.0\.0'/);
  assert.match(read('src/staff.js'), /__PRIDE_KEEPER_STAFF__\s*=\s*"5\.0\.0"/);
  assert.match(read('src/staff.js'), /headerVersionText:\s*"v5\.0/);
});

test('content script resources referenced by the manifest exist', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const paths = [
    manifest.background?.service_worker,
    ...(manifest.content_scripts || []).flatMap((entry) => [...(entry.js || []), ...(entry.css || [])]),
    ...Object.values(manifest.icons || {}),
    ...(manifest.web_accessible_resources || []).flatMap((entry) => entry.resources || [])
  ].filter(Boolean);
  for (const item of paths) assert.equal(fs.existsSync(path.join(root, item)), true, `${item} is missing`);
});
