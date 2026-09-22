import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreVertical } from "lucide-react";
import "./action-menu.css";

export default function ActionMenu({ label = "Thao tác", items = [], className = "", disabled = false }) {
  const actions = items.filter(Boolean);
  const unavailable = disabled || actions.every((action) => action.disabled);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const anchorRect = useRef(null);
  const initialFocus = useRef("first");
  const id = useId();

  function close(restoreFocus = false) {
    setOpen(false);
    setPosition(null);
    if (restoreFocus) triggerRef.current?.focus();
  }

  useLayoutEffect(() => {
    if (!open || !menuRef.current || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    anchorRect.current = rect;
    const width = Math.min(244, window.innerWidth - 24);
    const below = window.innerHeight - rect.bottom - 18;
    const above = rect.top - 18;
    const height = Math.min(menuRef.current.scrollHeight, 360);
    const placeAbove = below < height && above > below;
    const maxHeight = Math.max(40, Math.min(360, placeAbove ? above : below));
    setPosition({
      width,
      maxHeight,
      left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)),
      top: placeAbove ? Math.max(12, rect.top - Math.min(height, maxHeight) - 6) : rect.bottom + 6,
    });
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !position || !menuRef.current) return;
    const enabled = menuRef.current.querySelectorAll('[role="menuitem"]:not(:disabled)');
    (initialFocus.current === "last" ? enabled[enabled.length - 1] : enabled[0])?.focus();
  }, [open, position]);

  useEffect(() => {
    if (!open) return;
    const dismissOutside = (event) => {
      if (!menuRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target)) close();
    };
    const dismissScroll = (event) => {
      if (menuRef.current?.contains(event.target)) return;
      const rect = triggerRef.current?.getBoundingClientRect();
      const anchor = anchorRect.current;
      // Focus/click may finish scrolling the trigger into view after the menu opens.
      if (!rect || !anchor || Math.abs(rect.top - anchor.top) > 1 || Math.abs(rect.left - anchor.left) > 1) close();
    };
    const dismiss = () => close();
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    window.addEventListener("scroll", dismissScroll, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("hashchange", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
      window.removeEventListener("scroll", dismissScroll, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("hashchange", dismiss);
    };
  }, [open]);

  useEffect(() => {
    if (unavailable) close();
  }, [unavailable]);

  function onMenuKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") {
      close(true);
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const enabled = [...menuRef.current.querySelectorAll('[role="menuitem"]:not(:disabled)')];
      const index = enabled.indexOf(document.activeElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1 :
        (index + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length;
      enabled[next]?.focus();
    }
  }

  if (!actions.length) return null;
  return (
    <span className={`action-menu ${className}`}>
      <button
        type="button"
        className="action-menu-trigger"
        ref={triggerRef}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={unavailable}
        onClick={() => { initialFocus.current = "first"; open ? close() : setOpen(true); }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            close(true);
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            initialFocus.current = event.key === "ArrowUp" ? "last" : "first";
            setOpen(true);
          }
        }}
      >
        <MoreVertical size={19} aria-hidden="true" />
      </button>
      {open && createPortal(
        <div
          id={id}
          ref={menuRef}
          role="menu"
          aria-label={label}
          className="action-menu-popup"
          style={position || { visibility: "hidden", width: Math.min(244, window.innerWidth - 24) }}
          onKeyDown={onMenuKeyDown}
        >
          {actions.map(({ label: itemLabel, icon: Icon, onSelect, disabled: itemDisabled, danger }, index) => (
            <button
              key={`${itemLabel}-${index}`}
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={itemDisabled}
              className={`action-menu-item${danger ? " danger" : ""}`}
              onClick={() => { close(true); onSelect?.(triggerRef.current); }}
            >
              {Icon && <Icon size={16} aria-hidden="true" />}
              <span>{itemLabel}</span>
            </button>
          ))}
        </div>, document.body,
      )}
    </span>
  );
}
