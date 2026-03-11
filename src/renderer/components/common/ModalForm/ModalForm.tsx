/**
 * ModalForm Component
 * A Modal wrapper that provides form flow navigation:
 * - Enter on a single-line input focuses the next one
 * - Enter on the last single-line input triggers onSubmit
 */

import { Component, splitProps, createEffect, onCleanup } from 'solid-js';
import { Modal, type ModalProps } from '../Modal';

export interface ModalFormProps extends ModalProps {
  /** Called when Enter is pressed on the last navigable input (or the only one) */
  onSubmit?: () => void;
}

const NAVIGABLE_INPUT_TYPES = new Set([
  'text', 'url', 'email', 'search', 'tel', 'number', 'password', '',
]);

function isNavigableInput(el: Element): el is HTMLInputElement {
  if (el.tagName !== 'INPUT') return false;
  const input = el as HTMLInputElement;
  if (input.disabled || input.hidden || input.offsetParent === null) return false;
  const type = (input.type || 'text').toLowerCase();
  return NAVIGABLE_INPUT_TYPES.has(type);
}

export const ModalForm: Component<ModalFormProps> = (props) => {
  const [local, modalProps] = splitProps(props, ['onSubmit', 'children']);

  let containerRef: HTMLDivElement | undefined;

  const getNavigableInputs = (): HTMLInputElement[] => {
    if (!containerRef) return [];
    return Array.from(containerRef.querySelectorAll('input')).filter(isNavigableInput);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || e.isComposing) return;

    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    if (!isNavigableInput(target)) return;
    if (!containerRef?.contains(target)) return;

    e.preventDefault();

    const inputs = getNavigableInputs();
    const currentIndex = inputs.indexOf(target);

    if (currentIndex < inputs.length - 1) {
      inputs[currentIndex + 1].focus();
    } else {
      local.onSubmit?.();
    }
  };

  createEffect(() => {
    if (modalProps.isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      onCleanup(() => document.removeEventListener('keydown', handleKeyDown));
    }
  });

  return (
    <Modal {...modalProps}>
      <div ref={containerRef} style={{ display: 'contents' }}>
        {local.children}
      </div>
    </Modal>
  );
};
