/**
 * DraggablePopup Component
 * A draggable, resizable popup modal using Portal
 * Used for floating windows like LLM explanations
 */

import { Component, JSX, Show, For, createSignal, createEffect, onCleanup, splitProps, mergeProps } from 'solid-js';
import { Portal } from 'solid-js/web';
import { Panel } from '../Panel';
import { IconBtn } from '../Button';
import { CloseIcon } from '../Misc/Icons';
import { useLocalization } from '../../../context';
import './DraggablePopup.css';

export interface DraggablePopupProps {
  /** Whether the popup is open */
  isOpen: boolean;
  /** Callback when popup should close */
  onClose: () => void;
  /** Popup title */
  title?: string;
  /** Initial position (defaults to center) */
  initialPosition?: { x: number; y: number };
  /** Initial size */
  initialSize?: { width: number; height: number };
  /** Minimum size constraints */
  minSize?: { width: number; height: number };
  /** Maximum size constraints */
  maxSize?: { width: number; height: number };
  /** Whether to close on Escape key */
  closeOnEscape?: boolean;
  /** Whether to show close button */
  showCloseButton?: boolean;
  /** Header actions (buttons, etc.) */
  headerActions?: JSX.Element;
  /** Footer content */
  footer?: JSX.Element;
  /** Main content */
  children?: JSX.Element;
  /** Z-index (defaults to modal z-index) */
  zIndex?: number;
  /** Class name for the content area */
  contentClass?: string;
}

export const DraggablePopup: Component<DraggablePopupProps> = (props) => {
  const { t } = useLocalization();
  
  const merged = mergeProps(
    {
      initialSize: { width: 400, height: 300 },
      minSize: { width: 280, height: 200 },
      maxSize: { width: window.innerWidth - 40, height: window.innerHeight - 40 },
      closeOnEscape: true,
      showCloseButton: true,
      zIndex: 1000,
    },
    props
  );

  const [local] = splitProps(merged, [
    'isOpen',
    'onClose',
    'title',
    'initialPosition',
    'initialSize',
    'minSize',
    'maxSize',
    'closeOnEscape',
    'showCloseButton',
    'headerActions',
    'footer',
    'children',
    'zIndex',
    'contentClass',
  ]);

  // State for position and size
  const [position, setPosition] = createSignal<{ x: number; y: number }>({ x: 0, y: 0 });
  const [size, setSize] = createSignal<{ width: number; height: number }>(local.initialSize);
  const [isDragging, setIsDragging] = createSignal(false);
  const [isResizing, setIsResizing] = createSignal(false);
  const [dragOffset, setDragOffset] = createSignal({ x: 0, y: 0 });
  const [resizeStart, setResizeStart] = createSignal({ x: 0, y: 0, width: 0, height: 0 });
  const [resizeDirection, setResizeDirection] = createSignal<string>('');

  let popupRef: HTMLDivElement | undefined;

  // Initialize position when opening
  createEffect(() => {
    if (local.isOpen) {
      if (local.initialPosition) {
        setPosition(local.initialPosition);
      } else {
        // Center in viewport
        const centerX = (window.innerWidth - local.initialSize.width) / 2;
        const centerY = (window.innerHeight - local.initialSize.height) / 2;
        setPosition({ x: Math.max(20, centerX), y: Math.max(20, centerY) });
      }
      setSize(local.initialSize);
    }
  });

  // Handle escape key
  createEffect(() => {
    if (!local.isOpen || !local.closeOnEscape) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        local.onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    onCleanup(() => document.removeEventListener('keydown', handleEscape));
  });

  // Drag handlers
  const handleDragStart = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('.popup-header-actions')) return;
    e.preventDefault();
    setIsDragging(true);
    setDragOffset({
      x: e.clientX - position().x,
      y: e.clientY - position().y,
    });
  };

  const handleDragMove = (e: MouseEvent) => {
    if (!isDragging()) return;
    
    const newX = e.clientX - dragOffset().x;
    const newY = e.clientY - dragOffset().y;
    
    // Constrain to viewport
    const maxX = window.innerWidth - size().width - 10;
    const maxY = window.innerHeight - size().height - 10;
    
    setPosition({
      x: Math.max(10, Math.min(newX, maxX)),
      y: Math.max(10, Math.min(newY, maxY)),
    });
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

  // Resize handlers
  const handleResizeStart = (e: MouseEvent, direction: string) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    setResizeDirection(direction);
    setResizeStart({
      x: e.clientX,
      y: e.clientY,
      width: size().width,
      height: size().height,
    });
  };

  const handleResizeMove = (e: MouseEvent) => {
    if (!isResizing()) return;
    
    const start = resizeStart();
    const dir = resizeDirection();
    let newWidth = start.width;
    let newHeight = start.height;
    let newX = position().x;
    let newY = position().y;
    
    const deltaX = e.clientX - start.x;
    const deltaY = e.clientY - start.y;
    
    // Handle different resize directions
    if (dir.includes('e')) {
      newWidth = start.width + deltaX;
    }
    if (dir.includes('w')) {
      newWidth = start.width - deltaX;
      newX = position().x + (start.width - newWidth);
    }
    if (dir.includes('s')) {
      newHeight = start.height + deltaY;
    }
    if (dir.includes('n')) {
      newHeight = start.height - deltaY;
      newY = position().y + (start.height - newHeight);
    }
    
    // Apply constraints
    newWidth = Math.max(local.minSize.width, Math.min(newWidth, local.maxSize.width));
    newHeight = Math.max(local.minSize.height, Math.min(newHeight, local.maxSize.height));
    
    // Ensure popup stays in viewport
    newX = Math.max(10, Math.min(newX, window.innerWidth - newWidth - 10));
    newY = Math.max(10, Math.min(newY, window.innerHeight - newHeight - 10));
    
    setSize({ width: newWidth, height: newHeight });
    setPosition({ x: newX, y: newY });
  };

  const handleResizeEnd = () => {
    setIsResizing(false);
    setResizeDirection('');
  };

  // Global mouse event handlers
  createEffect(() => {
    if (!local.isOpen) return;

    const handleMouseMove = (e: MouseEvent) => {
      handleDragMove(e);
      handleResizeMove(e);
    };

    const handleMouseUp = () => {
      handleDragEnd();
      handleResizeEnd();
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    onCleanup(() => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    });
  });

  // Dynamic styles that must be inline (position/size)
  const popupStyle = (): JSX.CSSProperties => ({
    left: `${position().x}px`,
    top: `${position().y}px`,
    width: `${size().width}px`,
    height: `${size().height}px`,
    'z-index': local.zIndex,
  });

  const resizeDirections = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

  return (
    <Show when={local.isOpen}>
      <Portal>
        <div
          ref={popupRef}
          class={`draggable-popup ${isDragging() ? 'draggable-popup--dragging' : ''} ${isResizing() ? 'draggable-popup--resizing' : ''}`}
          style={popupStyle()}
        >
          <Panel
            variant="default"
            rounded="lg"
            padding="none"
            class="draggable-popup__panel"
          >
            {/* Header */}
            <div
              class="draggable-popup__header"
              onMouseDown={handleDragStart}
            >
              <Show when={local.title}>
                <span class="draggable-popup__title">
                  {local.title}
                </span>
              </Show>
              
              <div class="draggable-popup__header-actions popup-header-actions">
                {local.headerActions}
                <Show when={local.showCloseButton}>
                  <IconBtn
                    variant="ghost"
                    size="sm"
                    aria-label={t('mlearn.Global.Aria.CloseModal')}
                    onClick={local.onClose}
                  >
                    <CloseIcon size={16} />
                  </IconBtn>
                </Show>
              </div>
            </div>

            {/* Content */}
            <div class={`draggable-popup__content ${local.contentClass || ''}`}>
              {local.children}
            </div>

            {/* Footer */}
            <Show when={local.footer}>
              <div class="draggable-popup__footer">
                {local.footer}
              </div>
            </Show>
          </Panel>

          {/* Resize handles */}
          <For each={resizeDirections}>
            {(direction) => (
              <div
                class={`draggable-popup__resize-handle draggable-popup__resize-handle--${direction}`}
                onMouseDown={(e) => handleResizeStart(e, direction)}
              />
            )}
          </For>
        </div>
      </Portal>
    </Show>
  );
};
