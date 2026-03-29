// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';

describe('SchemaRenderer', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('renders object schema fields using runtime data values', async () => {
    const { SchemaRenderer } = await import('./SchemaRenderer');

    const schema = {
      title: 'Dictionary Panel',
      description: 'Shows the current lookup result.',
      type: 'object',
      properties: {
        word: { type: 'string', title: 'Word' },
        score: { type: 'number', title: 'Score' },
        enabled: { type: 'boolean', title: 'Enabled' },
      },
    };

    render(() => SchemaRenderer({ schema, data: { word: 'neko', score: 12.5, enabled: true } }), container);

    expect(container.textContent).toContain('Dictionary Panel');
    expect(container.textContent).toContain('Shows the current lookup result.');
    expect(container.textContent).toContain('Word');
    expect((container.querySelector('input[type="text"]') as HTMLInputElement).value).toBe('neko');
    expect(container.textContent).toContain('Score');
    expect((container.querySelector('input[type="number"]') as HTMLInputElement).value).toBe('12.5');
    expect(container.textContent).toContain('Enabled');
    expect((container.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true);
  });

  it('renders nested objects and arrays without crashing', async () => {
    const { SchemaRenderer } = await import('./SchemaRenderer');

    const schema = {
      title: 'Nested',
      type: 'object',
      properties: {
        details: {
          type: 'object',
          title: 'Details',
          properties: {
            reading: { type: 'string', title: 'Reading' },
          },
        },
        tags: {
          type: 'array',
          title: 'Tags',
        },
      },
    };

    render(() => SchemaRenderer({ schema, data: { details: { reading: 'ねこ' }, tags: ['animal', 'common'] } }), container);

    expect(container.textContent).toContain('Details');
    expect(container.textContent).toContain('Reading');
    expect(container.textContent).toContain('ねこ');
    expect(container.textContent).toContain('Tags');
    expect(container.textContent).toContain('animal');
    expect(container.textContent).toContain('common');
  });

  it('renders interactive inputs for v1 primitive field types and reports changes', async () => {
    const { SchemaRenderer } = await import('./SchemaRenderer');
    const handleChange = vi.fn<(nextData: Record<string, unknown>) => void>();

    const schema = {
      title: 'Editor',
      type: 'object',
      properties: {
        word: { type: 'string', title: 'Word' },
        retries: { type: 'number', title: 'Retries' },
        enabled: { type: 'boolean', title: 'Enabled' },
      },
    };

    render(() => SchemaRenderer({
      schema,
      data: { word: 'neko', retries: 2, enabled: false },
      onChange: handleChange,
    }), container);

    const textInput = container.querySelector('input[type="text"]') as HTMLInputElement;
    const numberInput = container.querySelector('input[type="number"]') as HTMLInputElement;
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;

    expect(textInput.value).toBe('neko');
    expect(numberInput.value).toBe('2');
    expect(checkbox.checked).toBe(false);

    textInput.value = 'inu';
    textInput.dispatchEvent(new Event('input', { bubbles: true }));

    numberInput.value = '5';
    numberInput.dispatchEvent(new Event('input', { bubbles: true }));

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));

    expect(handleChange).toHaveBeenNthCalledWith(1, { word: 'inu', retries: 2, enabled: false });
    expect(handleChange).toHaveBeenNthCalledWith(2, { word: 'inu', retries: 5, enabled: false });
    expect(handleChange).toHaveBeenNthCalledWith(3, { word: 'inu', retries: 5, enabled: true });
  });
});
