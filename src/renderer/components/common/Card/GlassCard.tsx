/**
 * Glass Card Component
 * Card container with glassmorphism styling
 */

import { Component, JSX, Show, splitProps, mergeProps } from 'solid-js';
import { GlassPanel, type GlassPanelProps } from '../Panel';

export interface GlassCardProps extends GlassPanelProps {
  title?: string;
  subtitle?: string;
  header?: JSX.Element;
  footer?: JSX.Element;
  headerActions?: JSX.Element;
  noPadding?: boolean;
}

export const GlassCard: Component<GlassCardProps> = (props) => {
  const merged = mergeProps(
    {
      padding: 'none' as const,
    },
    props
  );

  const [local, rest] = splitProps(merged, [
    'title',
    'subtitle',
    'header',
    'footer',
    'headerActions',
    'noPadding',
    'children',
  ]);

  const hasHeader = () => local.title || local.subtitle || local.header || local.headerActions;

  return (
    <GlassPanel {...rest}>
      <Show when={hasHeader()}>
        <div
          style={{
            display: 'flex',
            'align-items': 'flex-start',
            'justify-content': 'space-between',
            padding: '1rem',
            'border-bottom': '1px solid var(--glass-border)',
          }}
        >
          <div style={{ display: 'flex', 'flex-direction': 'column', gap: '0.25rem' }}>
            <Show when={local.header}>{local.header}</Show>
            <Show when={local.title}>
              <h3
                style={{
                  margin: '0',
                  'font-size': '1.125rem',
                  'font-weight': '600',
                  color: 'var(--text-primary)',
                }}
              >
                {local.title}
              </h3>
            </Show>
            <Show when={local.subtitle}>
              <p
                style={{
                  margin: '0',
                  'font-size': '0.875rem',
                  color: 'var(--text-secondary)',
                }}
              >
                {local.subtitle}
              </p>
            </Show>
          </div>
          <Show when={local.headerActions}>
            <div style={{ display: 'flex', gap: '0.5rem', 'flex-shrink': 0 }}>
              {local.headerActions}
            </div>
          </Show>
        </div>
      </Show>

      <div style={{ padding: local.noPadding ? '0' : '1rem' }}>
        {local.children}
      </div>

      <Show when={local.footer}>
        <div
          style={{
            padding: '1rem',
            'border-top': '1px solid var(--glass-border)',
          }}
        >
          {local.footer}
        </div>
      </Show>
    </GlassPanel>
  );
};
