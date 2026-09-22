// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import { FlashcardInspectButton } from './FlashcardInspectButton';
import { closeKnowledgeInspector, knowledgeInspection } from '../../services/openKnowledgeInspector';
import { surfaceEntityId } from '../../../shared/graph/load';
import { hashWordSync } from '../../services/srsAlgorithm';
vi.mock('../../context', () => ({ useLocalization: () => ({ t: (key: string) => key }) }));
vi.mock('../common/Button', () => ({ Btn: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} /> }));
it('opens the canonical card-language identity without toggling card selection', () => {
  const host = document.createElement('div'); document.body.append(host);
  const select = vi.fn();
  const dispose = render(() => <div onClick={select}><FlashcardInspectButton language="third-party" surface="example" /></div>, host);
  host.querySelector('button')!.click();
  expect(select).not.toHaveBeenCalled();
  expect(knowledgeInspection()).toEqual({ language: 'third-party', surface: 'example', target: { kind: 'surface', id: surfaceEntityId('third-party', hashWordSync('example')) } });
  closeKnowledgeInspector(); dispose(); host.remove();
});
