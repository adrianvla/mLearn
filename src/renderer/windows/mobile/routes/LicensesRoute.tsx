/**
 * Mobile Licenses Route
 * Simple component that renders license text.
 * The desktop version is a static HTML page; this wraps it for SolidJS routing.
 */

import { Component, onMount, createSignal } from 'solid-js';
import { useLocalization } from '../../../context';
import './LicensesRoute.css';
import { getLogger } from '../../../../shared/utils/logger';

const log = getLogger("renderer.mobile.licenses");

export const LicensesRoute: Component = () => {
  const { t } = useLocalization();
  const [html, setHtml] = createSignal('');

  onMount(async () => {
    try {
      const res = await fetch('./licenses.html');
      if (res.ok) {
        const text = await res.text();
        // Extract body content from the HTML
        const match = text.match(/<body[^>]*>([\s\S]*)<\/body>/i);
        if (match) {
          setHtml(match[1]);
        }
      }
    } catch (e) {
      log.error("error", e);
      setHtml(`<p>${t('mlearn.Settings.About.LicensesLoadError')}</p>`);
    }
  });

  return (
    <div
      class="licenses-content"
      innerHTML={html()}
    />
  );
};
