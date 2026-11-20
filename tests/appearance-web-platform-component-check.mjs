// Opt-in component check: uses the repository's existing mobile jsdom install.
// This renders the real web hook and page, but is not browser/device E2E evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const swc = require('next/dist/build/swc');
await swc.loadBindings();
require.extensions['.jsx'] = (module, file) => module._compile(swc.transformSync(readFileSync(file, 'utf8'), {
  filename: file,
  jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } },
  module: { type: 'commonjs' },
}).code, file);
require.extensions['.css'] = () => {};
const React = require('react');
const { JSDOM } = require('../mobile/node_modules/jsdom');
const { useAppearance } = require('../src/appearance.js');
const Appearance = require('../src/Appearance.jsx').default;

const result = { preferences: { mode: 'light' }, team: null, accessibility: { contrast: 'standard', motion: 'system' }, separate: false };

// React 19.3 no longer exposes act(), so renders settle over macrotasks instead.
const flush = async (rounds = 12) => { for (let index = 0; index < rounds; index++) await new Promise(resolve => setTimeout(resolve, 0)); };

// jsdom has neither ResizeObserver nor layout: the observer is a no-op and
// offsetHeight stays 0. Real layout is verified in the browser.
class Observer { observe() {} unobserve() {} disconnect() {} }

function mount(t) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.local', pretendToBeVisual: true });
  const saved = { window: globalThis.window, document: globalThis.document, ResizeObserver: globalThis.ResizeObserver };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, ResizeObserver: Observer });
  const { createRoot } = require('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  let version = 0;
  const draw = async element => { root.render(React.createElement(React.Fragment, { key: version++ }, element)); await flush(); };
  t.after(async () => { root.unmount(); await flush(); Object.assign(globalThis, saved); dom.window.close(); });
  return { dom, draw };
}

test('re-selecting the current scope issues no sync write while copy still does', async t => {
  const ui = mount(t);
  let appearance, current = false;
  const writes = [];
  const api = async (path, options) => {
    if (options?.method === 'PUT') { writes.push(JSON.parse(options.body)); current = writes.at(-1).separate; }
    return path === '/appearance/sync' ? { web: { separate: current }, mobile: { separate: false } } : { ...result, separate: current };
  };
  function Probe() {
    appearance = useAppearance({ api, userId: 'u', workspaceId: 'w', enabled: true, notify: () => {} });
    return null;
  }
  await ui.draw(React.createElement(Probe));
  assert.ok(appearance.ready);
  appearance.setSeparate(false); await flush();
  assert.equal(writes.length, 0);
  appearance.setSeparate(true); await flush();
  assert.equal(writes.length, 1);
  appearance.setSeparate(true); await flush();
  assert.equal(writes.length, 1);
  appearance.copyFrom('all'); await flush();
  assert.equal(writes.length, 2);
  assert.equal(writes[1].copyFrom, 'all');
});

test('dirty page pins the action bar and shows the unsaved cue', async t => {
  const ui = mount(t), props = appearanceProps();
  const Page = () => React.createElement(Appearance, props);
  const page = () => document.querySelector('.appearance-page');
  const bar = () => document.querySelector('.appearance-actions');
  await ui.draw(React.createElement(Page));
  assert.equal(page().classList.contains('is-dirty'), false);
  assert.equal(bar().classList.contains('is-sticky'), false, 'clean page keeps the bar in flow');

  document.querySelector('button[aria-label="Màu #176b59"]').click();
  await ui.draw(React.createElement(Page));
  assert.equal(page().classList.contains('is-dirty'), true);
  assert.equal(bar().classList.contains('is-sticky'), true);
  assert.match(document.querySelector('.appearance-dirty-cue').textContent, /Có thay đổi chưa lưu/);

  [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Hủy thay đổi').click();
  await ui.draw(React.createElement(Page));
  assert.equal(bar().classList.contains('is-sticky'), false);
  assert.equal(document.querySelector('.appearance-dirty-cue'), null);
});

test('a busy copy button keeps focus instead of falling to BODY', async t => {
  const props = appearanceProps();
  props.appearance.sync = { web: { separate: true }, mobile: { separate: true } };
  props.appearance.copyFrom = () => {
    props.appearance.busy = true;
    props.appearance.syncDisabledReason = 'Đang lưu giao diện…';
  };
  const ui = mount(t);
  ui.dom.window.confirm = () => true;
  const Page = () => React.createElement(Appearance, props);
  await ui.draw(React.createElement(Page));
  const copy = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Sao chép từ giao diện chung');
  assert.ok(copy);
  copy.focus();
  assert.equal(document.activeElement, copy);
  copy.click();
  await ui.draw(React.createElement(Page));
  const busy = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Sao chép từ giao diện chung');
  assert.equal(busy.disabled, false, 'busy copy buttons stay focusable');
  assert.equal(busy.getAttribute('aria-disabled'), 'true');
});

test('the scope select regains focus after the remount its route change causes', async t => {
  const go = [], teams = [{ id: 'team-1', name: 'Team một' }];
  const props = appearanceProps({ go: value => go.push(value), teams });
  const ui = mount(t);
  // App.jsx keys Appearance by workspace/team; the key change is what remounts it.
  await ui.draw(React.createElement(Appearance, { ...props, teamId: '', key: 'w/' }));
  const select = document.querySelector('.appearance-scope select');
  select.focus();
  Object.getOwnPropertyDescriptor(ui.dom.window.HTMLSelectElement.prototype, 'value').set.call(select, 'team-1');
  select.dispatchEvent(new ui.dom.window.Event('change', { bubbles: true })); await flush();
  assert.deepEqual(go, ['appearance?team=team-1'], 'scope change navigates to the keyed route');

  await ui.draw(React.createElement(Appearance, { ...props, teamId: 'team-1', key: 'w/team-1' }));
  assert.equal(document.activeElement.tagName, 'SELECT');
  assert.equal(document.activeElement.value, 'team-1');

  // A plain visit (no scope change) leaves focus where the browser put it.
  document.activeElement.blur();
  await ui.draw(React.createElement(Appearance, { ...props, teamId: '', key: 'w/' }));
  assert.notEqual(document.activeElement.tagName, 'SELECT');
});

function appearanceProps(overrides = {}) {
  const appearance = {
    ready: true, busy: false, dirty: false, editingTeam: false, error: null, remoteChanged: false, teamAccessLost: false,
    hasOverride: true, team: null, editableFields: ['accent', 'mode', 'hiddenNav', 'navOrder', 'contrast', 'motion'],
    policyFields: [], syncDisabledReason: '', sync: { web: { separate: false }, mobile: { separate: true } },
    preferences: { mode: 'light', accent: '#245bc0', navOrder: [] },
    change: (name, value) => { appearance.preferences = { ...appearance.preferences, [name]: value }; appearance.dirty = true; },
    save: () => {}, reset: () => {}, cancel: () => { appearance.dirty = false; }, setSeparate: () => {},
    copyFrom: () => {}, setEditingTeam: () => {}, setPolicyFields: () => {}, retry: () => {}, leave: () => {},
  };
  return { appearance, teams: [], teamId: '', go: () => {}, navGroups: [], ...overrides };
}
