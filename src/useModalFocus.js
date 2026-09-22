import { useEffect, useRef } from 'react';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Keep keyboard focus inside an open modal and return it to the opener after
 * the modal closes. The callback and disabled flag live in refs so a dialog
 * can re-render while the listener remains attached.
 */
export default function useModalFocus({ open, dialogRef, onClose, disabled = false }) {
  const closeRef = useRef(onClose);
  const disabledRef = useRef(disabled);
  closeRef.current = onClose;
  disabledRef.current = disabled;

  useEffect(() => {
    if (!open) return undefined;

    const previous = document.activeElement;
    const focusInitial = () => {
      const root = dialogRef.current;
      if (!root) return;
      const first = root.querySelector('[data-modal-autofocus], [autofocus], ' + FOCUSABLE);
      (first || root).focus?.();
    };
    const frame = window.requestAnimationFrame(focusInitial);
    const onKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!disabledRef.current) closeRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;

      const root = dialogRef.current;
      if (!root) return;
      const focusable = [...root.querySelectorAll(FOCUSABLE)];
      if (!focusable.length) {
        event.preventDefault();
        root.focus?.();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
      if (previous?.isConnected && typeof previous.focus === 'function') previous.focus();
    };
  }, [dialogRef, open]);
}
