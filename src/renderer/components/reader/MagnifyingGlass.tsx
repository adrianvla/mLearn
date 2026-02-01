/**
 * MagnifyingGlass Component
 * A magnifying glass overlay that zooms only the image, following the cursor.
 * Activated via configurable hotkey, does not magnify OCR overlay or other UI elements.
 * Features:
 * - Scroll wheel to adjust magnification (with smooth easing)
 * - Fade in/out animations on activation/deactivation
 * - Resets to default zoom when reactivated
 */

import { Component, createSignal, createEffect, onCleanup } from 'solid-js';
import { useSettings } from '../../context';
import { Badge } from '../common';
import './MagnifyingGlass.css';

export interface MagnifyingGlassProps {
    /** The container element that holds the page images */
    containerRef?: HTMLElement;
    /** List of image elements to magnify */
    imageElements: HTMLImageElement[];
    /** Whether the magnifier is enabled (controlled externally via hotkey) */
    active: boolean;
}

export const MagnifyingGlass: Component<MagnifyingGlassProps> = (props) => {
    const { settings } = useSettings();

    // Mouse position relative to the viewport
    const [mouseX, setMouseX] = createSignal(0);
    const [mouseY, setMouseY] = createSignal(0);

    // Current zoom level (animated) - starts at default
    const [currentZoom, setCurrentZoom] = createSignal(settings.readerMagnifierZoom ?? 2);
    // Target zoom level (for smooth animation)
    const [targetZoom, setTargetZoom] = createSignal(settings.readerMagnifierZoom ?? 2);

    // Visibility state for fade animation
    const [isVisible, setIsVisible] = createSignal(false);
    const [shouldRender, setShouldRender] = createSignal(false);

    // Canvas ref for rendering the zoomed image
    let canvasRef: HTMLCanvasElement | undefined;
    let animationFrameId: number | null = null;

    // Get settings with defaults
    const defaultZoom = () => settings.readerMagnifierZoom ?? 2;
    const lensSize = () => settings.readerMagnifierSize ?? 200;
    const minZoom = 1.5;
    const maxZoom = 6;

    // Track mouse position
    const handleMouseMove = (e: MouseEvent) => {
        setMouseX(e.clientX);
        setMouseY(e.clientY);
    };

    // Handle scroll wheel for zoom adjustment
    const handleWheel = (e: WheelEvent) => {
        if (!props.active) return;

        e.preventDefault();

        // Adjust zoom based on scroll direction
        const delta = e.deltaY > 0 ? -0.25 : 0.25;
        const newZoom = Math.max(minZoom, Math.min(maxZoom, targetZoom() + delta));
        setTargetZoom(newZoom);
    };

    // Smooth zoom animation
    const animateZoom = () => {
        const current = currentZoom();
        const target = targetZoom();
        const diff = target - current;

        // Ease towards target (exponential easing)
        if (Math.abs(diff) > 0.01) {
            setCurrentZoom(current + diff * 0.15);
            animationFrameId = requestAnimationFrame(animateZoom);
        } else {
            setCurrentZoom(target);
            animationFrameId = null;
        }
    };

    // Start zoom animation when target changes
    createEffect(() => {
        targetZoom(); // Track dependency
        if (animationFrameId === null && props.active) {
            animationFrameId = requestAnimationFrame(animateZoom);
        }
    });

    // Handle activation/deactivation with fade and zoom reset
    createEffect(() => {
        if (props.active) {
            // Reset zoom to default when activating
            const defaultVal = defaultZoom();
            setTargetZoom(defaultVal);
            setCurrentZoom(defaultVal);

            // Start rendering immediately, then fade in
            setShouldRender(true);
            // Small delay to ensure DOM is ready for animation
            requestAnimationFrame(() => {
                setIsVisible(true);
            });

            // Add event listeners
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('wheel', handleWheel, { passive: false });
        } else {
            // Fade out
            setIsVisible(false);

            // Remove event listeners
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('wheel', handleWheel);

            // Cancel animation
            if (animationFrameId !== null) {
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
            }
        }
    });

    // Handle fade out completion - stop rendering after animation
    const handleTransitionEnd = (e: TransitionEvent) => {
        if (e.propertyName === 'opacity' && !isVisible()) {
            setShouldRender(false);
        }
    };

    // Cleanup
    onCleanup(() => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('wheel', handleWheel);
        if (animationFrameId !== null) {
            cancelAnimationFrame(animationFrameId);
        }
    });

    // Render the magnified image portion to canvas
    createEffect(() => {
        if (!shouldRender() || !canvasRef) return;

        const canvas = canvasRef;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const size = lensSize();
        const zoom = currentZoom();
        const mx = mouseX();
        const my = mouseY();

        // Clear canvas
        ctx.clearRect(0, 0, size, size);

        // Find which image the mouse is over
        let targetImage: HTMLImageElement | null = null;
        let imgRect: DOMRect | null = null;

        for (const img of props.imageElements) {
            if (!img) continue;
            const rect = img.getBoundingClientRect();
            if (mx >= rect.left && mx <= rect.right && my >= rect.top && my <= rect.bottom) {
                targetImage = img;
                imgRect = rect;
                break;
            }
        }

        if (!targetImage || !imgRect) {
            // Mouse not over any image, show gray
            ctx.fillStyle = 'rgba(50, 50, 50, 0.8)';
            ctx.fillRect(0, 0, size, size);
            return;
        }

        // Calculate the position in image coordinates
        // Account for the difference between displayed size and natural size
        const scaleX = targetImage.naturalWidth / imgRect.width;
        const scaleY = targetImage.naturalHeight / imgRect.height;

        // Position relative to the image element
        const relX = mx - imgRect.left;
        const relY = my - imgRect.top;

        // Source position in original image coordinates
        const srcX = relX * scaleX;
        const srcY = relY * scaleY;

        // Calculate source rectangle size (in original image coordinates)
        const srcSize = (size / zoom) * scaleX;

        // Calculate source rectangle position (centered on cursor)
        const srcLeft = srcX - srcSize / 2;
        const srcTop = srcY - srcSize / 2;

        // Draw the magnified portion
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        try {
            ctx.drawImage(
                targetImage,
                srcLeft,
                srcTop,
                srcSize,
                srcSize,
                0,
                0,
                size,
                size
            );
        } catch (e) {
            // Handle potential cross-origin or security errors
            ctx.fillStyle = 'rgba(50, 50, 50, 0.8)';
            ctx.fillRect(0, 0, size, size);
        }
    });

    return (
        <div
            class="magnifying-glass"
            classList={{ 'visible': isVisible(), 'hidden': !isVisible() }}
            style={{
                left: `${mouseX() - lensSize() / 2}px`,
                top: `${mouseY() - lensSize() / 2}px`,
                width: `${lensSize()}px`,
                height: `${lensSize()}px`,
                display: shouldRender() ? 'block' : 'none',
            }}
            onTransitionEnd={handleTransitionEnd}
        >
            <canvas
                ref={canvasRef}
                width={lensSize()}
                height={lensSize()}
                class="magnifying-glass-canvas"
            />
            <div class="magnifying-glass-border" />
            <div class="magnifying-glass-crosshair" />
            {/* Zoom indicator using Badge component */}
            <Badge size="xs" class="magnifying-glass-zoom-badge">
                {currentZoom().toFixed(1)}x
            </Badge>
        </div>
    );
};

export default MagnifyingGlass;
