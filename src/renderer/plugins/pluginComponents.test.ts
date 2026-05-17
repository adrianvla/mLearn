import { describe, expect, it } from 'vitest';

import { pluginComponentLibrary } from './pluginComponents';

describe('pluginComponentLibrary', () => {
  it('exports button components', () => {
    expect(pluginComponentLibrary.Btn).toBeDefined();
    expect(typeof pluginComponentLibrary.Btn).toBe('function');
    expect(pluginComponentLibrary.PillBtn).toBeDefined();
    expect(pluginComponentLibrary.IconBtn).toBeDefined();
    expect(pluginComponentLibrary.NavBtn).toBeDefined();
    expect(pluginComponentLibrary.TabBtn).toBeDefined();
  });

  it('exports modal components', () => {
    expect(pluginComponentLibrary.Modal).toBeDefined();
    expect(typeof pluginComponentLibrary.Modal).toBe('function');
    expect(pluginComponentLibrary.ConfirmDialog).toBeDefined();
    expect(pluginComponentLibrary.ErrorModal).toBeDefined();
    expect(pluginComponentLibrary.DraggablePopup).toBeDefined();
  });

  it('exports input components', () => {
    expect(pluginComponentLibrary.Input).toBeDefined();
    expect(typeof pluginComponentLibrary.Input).toBe('function');
    expect(pluginComponentLibrary.Textarea).toBeDefined();
    expect(pluginComponentLibrary.ToggleSwitch).toBeDefined();
  });

  it('exports card components', () => {
    expect(pluginComponentLibrary.Card).toBeDefined();
    expect(typeof pluginComponentLibrary.Card).toBe('function');
    expect(pluginComponentLibrary.ActionCard).toBeDefined();
    expect(pluginComponentLibrary.CheckboxCard).toBeDefined();
  });

  it('exports layout components', () => {
    expect(pluginComponentLibrary.Flex).toBeDefined();
    expect(typeof pluginComponentLibrary.Flex).toBe('function');
    expect(pluginComponentLibrary.Row).toBeDefined();
    expect(pluginComponentLibrary.Column).toBeDefined();
  });

  it('exports icon components', () => {
    expect(pluginComponentLibrary.CloseIcon).toBeDefined();
    expect(typeof pluginComponentLibrary.CloseIcon).toBe('function');
    expect(pluginComponentLibrary.CheckIcon).toBeDefined();
    expect(pluginComponentLibrary.PlusIcon).toBeDefined();
  });

  it('exports feedback components', () => {
    expect(pluginComponentLibrary.AlertBanner).toBeDefined();
    expect(typeof pluginComponentLibrary.AlertBanner).toBe('function');
    expect(pluginComponentLibrary.EmptyState).toBeDefined();
    expect(pluginComponentLibrary.ProgressBar).toBeDefined();
  });

  it('exports loader components', () => {
    expect(pluginComponentLibrary.Loader).toBeDefined();
    expect(typeof pluginComponentLibrary.Loader).toBe('function');
    expect(pluginComponentLibrary.Spinner).toBeDefined();
    expect(pluginComponentLibrary.Skeleton).toBeDefined();
  });

  it('exports panel components', () => {
    expect(pluginComponentLibrary.Panel).toBeDefined();
    expect(typeof pluginComponentLibrary.Panel).toBe('function');
    expect(pluginComponentLibrary.WindowLayout).toBeDefined();
    expect(pluginComponentLibrary.PanelHeader).toBeDefined();
  });

  it('exports tab components', () => {
    expect(pluginComponentLibrary.TabHeader).toBeDefined();
    expect(typeof pluginComponentLibrary.TabHeader).toBe('function');
    expect(pluginComponentLibrary.TabContent).toBeDefined();
    expect(pluginComponentLibrary.TabContainer).toBeDefined();
    expect(pluginComponentLibrary.TabPanel).toBeDefined();
  });
});
