import createDOMPurify, { type WindowLike } from 'dompurify';

// Default import returns empty strings under happy-dom; bind explicitly to window.
// DOMPurify feature-detects Trusted Types at runtime. Its WindowLike type
// requires the member even on browsers where the optional API is absent.
const purify = createDOMPurify(window as unknown as WindowLike);

// Default DOMPurify URI allowlist extended with the app's custom media protocols.
const ALLOWED_URI_REGEXP =
  /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix|flashcard-image|flashcard-audio|local-media):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

export function sanitizeHtml(dirty: string): string {
  return purify.sanitize(dirty, { ALLOWED_URI_REGEXP });
}
