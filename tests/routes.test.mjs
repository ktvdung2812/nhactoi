import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyHashTarget } from '../src/routes.js';

test('legacy hash bookmarks only restore known same-app routes', () => {
  assert.equal(legacyHashTarget('#/dashboard'), '/dashboard');
  assert.equal(legacyHashTarget('#/tasks/task_1', '?view=board'), '/tasks/task_1?view=board');
  assert.equal(legacyHashTarget('#/admin/tickets?workspaceId=ws_1', '?ignored=1'), '/admin/tickets?workspaceId=ws_1');
  for (const hash of ['#//evil.com/login', '#/\\evil.com', '#/\\/evil.com', '#/%2F%2Fevil.com', '#/https://evil.com', '#/no-such-page', '#/', '', '#dashboard'])
    assert.equal(legacyHashTarget(hash, '?x=1'), null, hash);
});
