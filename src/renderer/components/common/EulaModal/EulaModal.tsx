import { Component, createSignal, onMount, onCleanup } from 'solid-js';
import { getBridge } from '@shared/bridges';
import { useSettings, useLocalization } from '@renderer/context';
import { Btn, CheckboxCard } from '../';
import './EulaModal.css';

export interface EulaModalProps {
  onAccept: () => void;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatInline(text: string): string {
  let result = escapeHtml(text);
  result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  result = result.replace(/\*(.+?)\*/g, '<em>$1</em>');
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return result;
}

function markdownToHtml(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inList = false;
  let listType: 'ul' | 'ol' | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim() === '') {
      if (inList) {
        out.push(listType === 'ul' ? '</ul>' : '</ol>');
        inList = false;
        listType = null;
      }
      continue;
    }

    if (line.startsWith('# ')) {
      out.push(`<h1>${formatInline(line.slice(2))}</h1>`);
      continue;
    }
    if (line.startsWith('## ')) {
      out.push(`<h2>${formatInline(line.slice(3))}</h2>`);
      continue;
    }
    if (line.startsWith('### ')) {
      out.push(`<h3>${formatInline(line.slice(4))}</h3>`);
      continue;
    }

    if (line.startsWith('- ')) {
      if (!inList || listType !== 'ul') {
        if (inList) out.push(listType === 'ul' ? '</ul>' : '</ol>');
        out.push('<ul>');
        inList = true;
        listType = 'ul';
      }
      out.push(`<li>${formatInline(line.slice(2))}</li>`);
      continue;
    }

    if (/^\d+\. /.test(line)) {
      if (!inList || listType !== 'ol') {
        if (inList) out.push(listType === 'ul' ? '</ul>' : '</ol>');
        out.push('<ol>');
        inList = true;
        listType = 'ol';
      }
      out.push(`<li>${formatInline(line.replace(/^\d+\. /, ''))}</li>`);
      continue;
    }

    if (line.trim() === '---') {
      out.push('<hr>');
      continue;
    }

    out.push(`<p>${formatInline(line)}</p>`);
  }

  if (inList) {
    out.push(listType === 'ul' ? '</ul>' : '</ol>');
  }

  return out.join('\n');
}

export const EulaModal: Component<EulaModalProps> = (props) => {
  const { t } = useLocalization();
  const { updateSettings } = useSettings();
  const [eulaContent, setEulaContent] = createSignal('');
  const [hasRead, setHasRead] = createSignal(false);
  const [isLoading, setIsLoading] = createSignal(true);
  const [hasScrolledToBottom, setHasScrolledToBottom] = createSignal(false);

  let documentRef: HTMLDivElement | undefined;

  onMount(() => {
    const bridge = getBridge();
    const cleanup = bridge.server.onLegalDocumentReceive((content) => {
      setEulaContent(content);
      setIsLoading(false);
    });
    bridge.server.getLegalDocument('EULA');
    onCleanup(() => {
      cleanup();
    });
  });

  const handleScroll = () => {
    const el = documentRef;
    if (!el) return;
    const threshold = 10;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - threshold;
    if (atBottom) {
      setHasScrolledToBottom(true);
    }
  };

  const handleAccept = () => {
    updateSettings({
      eulaAccepted: true,
      eulaAcceptedVersion: '1.0',
      eulaAcceptedAt: Date.now(),
    });
    props.onAccept();
  };

  return (
    <div class="eula-overlay">
      <div class="eula-card">
        <div class="eula-content">
          <h2 class="eula-title">{t('mlearn.Eula.Title')}</h2>

          <div
            class="eula-document"
            ref={documentRef}
            onScroll={handleScroll}
          >
            {isLoading() ? (
              <p class="eula-loading">{t('mlearn.Eula.Loading')}</p>
            ) : (
              <div class="eula-text" innerHTML={markdownToHtml(eulaContent())} />
            )}
          </div>

          <CheckboxCard
            checked={hasRead()}
            onChange={setHasRead}
            title={t('mlearn.Eula.AgreeLabel')}
            disabled={!hasScrolledToBottom()}
            class="eula-checkbox-card"
          />
        </div>

        <div class="eula-actions">
          <Btn
            variant="primary"
            size="lg"
            onClick={handleAccept}
            disabled={!hasRead()}
            class="eula-accept-btn"
          >
            {t('mlearn.Eula.AcceptButton')}
          </Btn>
        </div>
      </div>
    </div>
  );
};
