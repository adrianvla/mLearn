// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { WelcomeFeatureCard } from './WelcomeFeatureCard';

describe('WelcomeFeatureCard', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('renders a compound card: article, main button, and preview sibling', () => {
    const dispose = render(
      () => (
        <WelcomeFeatureCard
          icon={<span class="mock-icon" />}
          title="Title"
          description="Desc"
          preview={<button type="button" class="preview-btn" onClick={() => {}}>Action</button>}
        />
      ),
      container,
    );

    const article = container.querySelector('article.welcome-feature-card');
    const main = container.querySelector<HTMLButtonElement>('button.welcome-feature-card-main');
    const preview = container.querySelector('.welcome-feature-card-preview');

    expect(article).not.toBeNull();
    expect(main).not.toBeNull();
    expect(preview).not.toBeNull();

    // The preview is a sibling, never nested inside the main-action button
    expect(article?.contains(preview as Node)).toBe(true);
    expect(main?.contains(preview as Node)).toBe(false);

    // Main button is associated with the title and description
    const titleEl = container.querySelector('h3');
    expect(titleEl?.textContent).toBe('Title');
    expect(main?.getAttribute('aria-labelledby')).toBe(titleEl?.id);
    const descEl = container.querySelector('p');
    expect(descEl?.textContent).toBe('Desc');
    expect(main?.getAttribute('aria-describedby')).toBe(descEl?.id);

    dispose();
  });

  it('omits the preview slot when none is provided', () => {
    const dispose = render(
      () => <WelcomeFeatureCard icon={<span />} title="Title" description="Desc" />,
      container,
    );

    expect(container.querySelector('.welcome-feature-card-preview')).toBeNull();

    dispose();
  });

  it('fires the main onClick when the main button is activated', () => {
    const onClick = vi.fn();
    const dispose = render(
      () => (
        <WelcomeFeatureCard icon={<span />} title="Title" description="Desc" onClick={onClick} />
      ),
      container,
    );

    const main = container.querySelector<HTMLButtonElement>('button.welcome-feature-card-main');
    expect(main?.disabled).toBe(false);
    main?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onClick).toHaveBeenCalledTimes(1);

    dispose();
  });

  it('does not fire the main onClick when a preview control is clicked', () => {
    const onClick = vi.fn();
    const previewClick = vi.fn();
    const dispose = render(
      () => (
        <WelcomeFeatureCard
          icon={<span />}
          title="Title"
          description="Desc"
          onClick={onClick}
          preview={<button type="button" class="preview-btn" onClick={previewClick}>Action</button>}
        />
      ),
      container,
    );

    container.querySelector('.preview-btn')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(previewClick).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();

    dispose();
  });

  it('blocks the disabled main action while preview controls keep working', () => {
    const onClick = vi.fn();
    const previewClick = vi.fn();
    const dispose = render(
      () => (
        <WelcomeFeatureCard
          icon={<span />}
          title="Title"
          description="Desc"
          onClick={onClick}
          disabled
          preview={<button type="button" class="preview-btn" onClick={previewClick}>Action</button>}
        />
      ),
      container,
    );

    const main = container.querySelector<HTMLButtonElement>('button.welcome-feature-card-main');
    expect(main?.disabled).toBe(true);
    main?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onClick).not.toHaveBeenCalled();

    container.querySelector('.preview-btn')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(previewClick).toHaveBeenCalledTimes(1);

    dispose();
  });

  it('marks the root without the global disabled class so the preview stays readable and clickable', () => {
    const dispose = render(
      () => (
        <WelcomeFeatureCard
          icon={<span />}
          title="Title"
          description="Desc"
          disabled
          preview={<button type="button" class="preview-btn" onClick={() => {}}>Action</button>}
        />
      ),
      container,
    );

    const article = container.querySelector('article.welcome-feature-card');
    expect(article?.classList.contains('disabled')).toBe(false);
    expect(article?.classList.contains('is-main-disabled')).toBe(true);

    const main = container.querySelector<HTMLButtonElement>('button.welcome-feature-card-main');
    expect(main?.disabled).toBe(true);

    dispose();
  });

  it('instantiates the preview exactly once', () => {
    let renderCount = 0;
    const CountingPreview = () => {
      renderCount += 1;
      return <span class="counted-preview" />;
    };

    const dispose = render(
      () => (
        <WelcomeFeatureCard
          icon={<span />}
          title="Title"
          description="Desc"
          preview={<CountingPreview />}
        />
      ),
      container,
    );

    expect(container.querySelector('.counted-preview')).not.toBeNull();
    expect(renderCount).toBe(1);

    dispose();
  });
});
