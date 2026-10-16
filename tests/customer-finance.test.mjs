import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'next/dist/build/swc/index.js';

const require = createRequire(import.meta.url);
const exports = {};
const { code } = transformSync(readFileSync(new URL('../src/CustomerDetail.jsx', import.meta.url), 'utf8'), {
  jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } },
  module: { type: 'commonjs' },
});
runInNewContext(code, { exports, require: id => id.endsWith('.css') ? {} : require(id) });

test('TC-W0-T04-A: customer income uses transaction type when income and expenses are both positive', () => {
  const html = renderToStaticMarkup(React.createElement(exports.default, {
    customerId: 'customer-1',
    customers: [{ id: 'customer-1', name: 'Khách hàng kiểm thử' }],
    transactions: [
      { id: 'income', customerId: 'customer-1', type: 'income', amount: 100 },
      { id: 'expense', customerId: 'customer-1', type: 'expense', amount: 40 },
      { id: 'other-customer', customerId: 'customer-2', type: 'income', amount: 200 },
    ],
    me: { workspace: { role: 'owner' } },
  }));
  assert.match(html, /Tổng thu từ khách hàng[\s\S]*?class="stat-value">100\s*₫/);
  assert.doesNotMatch(html, /class="stat-value">(?:140|340)\s*₫/);
});
