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

test("dark mode defines styles for task detail modal and inner elements", () => {
  const styles = fs.readFileSync("src/styles.css", "utf8");
  const taskDetailCss = fs.readFileSync("src/task-detail.css", "utf8");

  assert.ok(styles.includes('[data-theme="dark"] .task-detail-modal'));
  assert.ok(styles.includes('[data-theme="dark"] .task-detail-modal-backdrop'));
  assert.ok(styles.includes('[data-theme="dark"] .td-heading'));
  assert.ok(styles.includes('[data-theme="dark"] .td-back'));
  assert.ok(styles.includes('[data-theme="dark"] .task-detail-modal-close'));
  assert.ok(styles.includes('[data-theme="dark"] .td-tasklist'));
  assert.ok(styles.includes('[data-theme="dark"] .td-tasklist-head h3'));
  assert.ok(styles.includes('[data-theme="dark"] .td-tasklist-panel'));

  assert.ok(taskDetailCss.includes('[data-theme="dark"] .task-detail-modal'));
  assert.ok(taskDetailCss.includes('[data-theme="dark"] .task-detail-modal-backdrop'));
  assert.ok(taskDetailCss.includes('[data-theme="dark"] .td-heading'));
  assert.ok(taskDetailCss.includes(".td-heading{position:sticky;top:0"));
  assert.ok(taskDetailCss.includes(".task-detail-modal-close{position:sticky;top:10px"));
  assert.ok(taskDetailCss.includes('[data-theme="dark"] .td-tasklist'));
  assert.ok(taskDetailCss.includes('[data-theme="dark"] .td-tasklist-head h3'));
  assert.ok(taskDetailCss.includes('[data-theme="dark"] .td-tasklist-panel'));
  assert.ok(!taskDetailCss.includes("background:var(--bg)"));
});

test("dark mode defines styles for admin platform, templates, and trash pages", () => {
  const styles = fs.readFileSync("src/styles.css", "utf8");
  const adminCss = fs.readFileSync("src/admin.css", "utf8");
  const adminDetailsCss = fs.readFileSync("src/admin-details.css", "utf8");
  const adminSettingsCss = fs.readFileSync("src/admin-settings.css", "utf8");
  const taskExtrasCss = fs.readFileSync("src/task-extras.css", "utf8");
  const trashCss = fs.readFileSync("src/trash.css", "utf8");
  const servicesCss = fs.readFileSync("src/services.css", "utf8");

  // Admin Overview in admin.css and styles.css
  assert.ok(adminCss.includes('[data-theme="dark"] .admin-overview-banner'));
  assert.ok(adminCss.includes('[data-theme="dark"] .admin-metric'));
  assert.ok(adminCss.includes('[data-theme="dark"] .admin-revenue-strip'));
  assert.ok(styles.includes('[data-theme="dark"] .admin-overview-banner'));
  assert.ok(styles.includes('[data-theme="dark"] .admin-metric'));
  assert.ok(styles.includes('[data-theme="dark"] .admin-revenue-strip'));

  // Admin details
  assert.ok(adminDetailsCss.includes('[data-theme="dark"] .admin-details-panel'));
  assert.ok(adminDetailsCss.includes('[data-theme="dark"] .admin-details-stat'));

  // Admin settings
  assert.ok(adminSettingsCss.includes('[data-theme="dark"] .settings-plan'));

  // Task templates & extras
  assert.ok(taskExtrasCss.includes('[data-theme="dark"] .task-template-card'));
  assert.ok(taskExtrasCss.includes('[data-theme="dark"] .task-extras-panel'));
  assert.ok(taskExtrasCss.includes('[data-theme="dark"] .task-extras-modal'));

  // Trash
  assert.ok(trashCss.includes('[data-theme="dark"] .trash-dialog'));

  // Services
  assert.ok(servicesCss.includes('[data-theme="dark"] .services-modal'));
});
