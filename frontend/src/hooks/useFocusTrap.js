import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

const activeTraps = [];

export default function useFocusTrap(containerRef, onClose) {
  const previousFocusRef = useRef(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    previousFocusRef.current = document.activeElement;
    const container = containerRef.current;
    if (!container) return undefined;
    activeTraps.push(container);

    const focusable = () => Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(element =>
      !element.matches(':disabled') && !element.closest('[hidden], [inert]') && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden');
    const firstFocusable = focusable()[0];
    (firstFocusable || container).focus({ preventScroll: true });

    const handleKeyDown = (event) => {
      if (activeTraps.at(-1) !== container) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      if (elements.length === 0) {
        event.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }

      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!container.contains(document.activeElement) || document.activeElement === container) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus({ preventScroll: true });
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    const containFocus = (event) => {
      if (activeTraps.at(-1) === container && !container.contains(event.target)) {
        (focusable()[0] || container).focus({ preventScroll: true });
      }
    };
    document.addEventListener('focusin', containFocus);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('focusin', containFocus);
      const index = activeTraps.indexOf(container);
      if (index !== -1) activeTraps.splice(index, 1);
      if (previousFocusRef.current?.isConnected && typeof previousFocusRef.current.focus === 'function') {
        previousFocusRef.current.focus({ preventScroll: true });
      } else {
        (activeTraps.at(-1) || document.querySelector('[aria-label="BookWise home"]'))?.focus({ preventScroll: true });
      }
    };
  }, [containerRef]);
}
