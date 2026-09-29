"use client";

import React from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "./theme.js";
import "./theme-toggle.css";

const OPTIONS = [
  { value: "system", label: "Tự động", icon: Monitor },
  { value: "light", label: "Sáng", icon: Sun },
  { value: "dark", label: "Tối", icon: Moon },
];

const RESOLVED_LABEL = { dark: "tối", light: "sáng" };

export function ThemeToggleButton({ className = "", disabled = false, disabledReason = "" }) {
  const { resolvedTheme, setTheme } = useTheme();
  const nextMode = resolvedTheme === "dark" ? "light" : "dark";
  const label = nextMode === "light" ? "Chuyển sang chế độ sáng" : "Chuyển sang chế độ tối";

  return (
    <button
      type="button"
      disabled={disabled || !!disabledReason}
      className={`theme-toggle-btn icon-button ${className}`.trim()}
      aria-label={disabledReason || label}
      title={disabledReason || label}
      onClick={() => setTheme(nextMode)}
    >
      {nextMode === "light" ? <Sun size={19} /> : <Moon size={19} />}
    </button>
  );
}

export default function ThemeToggle({ className = "" }) {
  const { theme, setTheme, resolvedTheme } = useTheme();

  return (
    <div
      className={`theme-toggle ${className}`.trim()}
      role="radiogroup"
      aria-label="Chế độ hiển thị"
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = theme === value;
        const title =
          value === "system"
            ? `Tự động theo thiết bị (đang ${RESOLVED_LABEL[resolvedTheme] || "sáng"})`
            : `Chế độ ${label.toLowerCase()}`;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            className={`theme-toggle-option ${active ? "active" : ""}`}
            title={title}
            onClick={() => setTheme(value)}
          >
            <Icon size={16} />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
