import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { THEME_CYCLE, resolveTheme } from "../src/theme.js";

test("theme definitions include valid and consistent mode values", () => {
  assert.equal(THEME_CYCLE.light, "dark");
  assert.equal(THEME_CYCLE.dark, "system");
  assert.equal(THEME_CYCLE.system, "light");
  assert.equal(resolveTheme("light"), "light");
  assert.equal(resolveTheme("dark"), "dark");
});

test("theme styles define high-contrast dark theme surfaces and borders", () => {
  const styles = fs.readFileSync("src/styles.css", "utf8");

  // Check that dark mode defines card borders
  assert.ok(styles.includes('[data-theme="dark"] :is('));
  assert.ok(styles.includes('.dark :is('));
  assert.ok(styles.includes('border: 1px solid var(--border-card'));
  assert.ok(styles.includes('.td-tasklist'));

  // Check auth form dark mode styles
  assert.ok(styles.includes('[data-theme="dark"] .auth-form'));
  assert.ok(styles.includes('[data-theme="dark"] .auth-task-preview'));
  assert.ok(styles.includes('.dark .auth-form'));

  // Primary buttons use crisp high-contrast light background with dark text
  assert.ok(styles.includes('[data-theme="dark"] .button'));
  assert.ok(styles.includes("background: #f0f2f5;"));
  assert.ok(styles.includes("color: #101214;"));
  assert.ok(styles.includes('[data-theme="dark"] .filter-tabs button.active'));
});

// Feature rules take their surface, text and border colors from the shared
// tokens, so they follow dark mode, custom backgrounds and high contrast
// without a per-component dark override.
function baseRules(css, selector) {
  const bodies = [];
  for (const [, selectors, body] of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g))
    if (selectors.split(",").map((item) => item.trim().replace(/\s+/g, " ")).includes(selector)) bodies.push(body);
  return bodies;
}

function assertThemed(file, selectors) {
  const css = fs.readFileSync(file, "utf8");
  for (const selector of selectors) {
    const bodies = baseRules(css, selector);
    assert.ok(bodies.length, `${file}: ${selector} has a base rule`);
    const colors = bodies.join(";").split(";").map((item) => item.trim())
      .filter((item) => /^(background|background-color|color|border|border-color|border-top|border-bottom)\s*:/.test(item));
    for (const declaration of colors)
      assert.match(declaration, /var\(--|transparent|inherit|currentColor|none|:\s*0\s*$/, `${file}: ${selector} hard-codes "${declaration}"`);
  }
}

test("task detail modal and inner elements use theme tokens", () => {
  const taskDetailCss = fs.readFileSync("src/task-detail.css", "utf8");
  assertThemed("src/task-detail.css", [".task-detail-modal", ".td-heading", ".td-back", ".task-detail-modal-close",
    ".td-tasklist", ".td-tasklist-head h3", ".td-tasklist-panel"]);
  assert.ok(taskDetailCss.includes(".td-heading{position:sticky;top:0"));
  assert.ok(taskDetailCss.includes(".task-detail-modal-close{position:sticky;top:10px"));
  assert.ok(!taskDetailCss.includes("background:var(--bg)"));
});

test("admin platform, templates, trash, services and teams use theme tokens", () => {
  assertThemed("src/admin.css", [".admin-overview-banner", ".admin-metric", ".admin-revenue-strip"]);
  assertThemed("src/admin-details.css", [".admin-details-panel", ".admin-details-stat"]);
  assertThemed("src/admin-settings.css", [".settings-plan"]);
  assertThemed("src/task-extras.css", [".task-template-card", ".task-extras-panel", ".task-extras-modal"]);
  assertThemed("src/trash.css", [".trash-dialog"]);
  assertThemed("src/teams.css", [".teams-empty", ".teams-empty-icon"]);
  assert.ok(fs.readFileSync("src/services.css", "utf8").includes('[data-theme="dark"] .services-modal'));
});

test("design tokens define light and dark values for status and on-accent colors", () => {
  const css = fs.readFileSync("src/design-system.css", "utf8");
  const light = css.slice(css.indexOf(":root {"), css.indexOf('[data-theme="dark"],'));
  const dark = css.slice(css.indexOf('[data-theme="dark"],'), css.indexOf("body {"));
  for (const token of ["--on-green", "--primary", "--on-primary", "--danger", "--danger-subtle", "--warning", "--warning-subtle", "--info", "--info-subtle"]) {
    assert.ok(light.includes(`${token}:`), `light ${token}`);
    assert.ok(dark.includes(`${token}:`), `dark ${token}`);
  }
});
