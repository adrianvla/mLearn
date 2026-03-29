import { Component, For, Match, Show, Switch, createEffect, createSignal } from 'solid-js';

interface SchemaRendererProps {
  schema: Record<string, unknown>;
  data?: Record<string, unknown>;
  onChange?: (nextData: Record<string, unknown>) => void;
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value === null || value === undefined) {
    return '-';
  }
  return JSON.stringify(value);
}

const SchemaValue: Component<{ schema?: Record<string, unknown>; value: unknown }> = (props) => {
  const type = () => props.schema?.type;
  const objectProperties = () => {
    const rawProperties = props.schema?.properties;
    if (!rawProperties || typeof rawProperties !== 'object' || Array.isArray(rawProperties)) {
      return {} as Record<string, Record<string, unknown>>;
    }
    return rawProperties as Record<string, Record<string, unknown>>;
  };

  return (
    <Switch fallback={<span>{stringifyValue(props.value)}</span>}>
      <Match when={type() === 'object' && props.value && typeof props.value === 'object' && !Array.isArray(props.value)}>
        <div class="plugin-schema__object">
          <For each={Object.entries(props.value as Record<string, unknown>)}>
            {([key, value]) => {
              const fieldSchema = objectProperties()[key];
              return (
                <div class="plugin-schema__field">
                  <div class="plugin-schema__label">{(fieldSchema?.title as string | undefined) ?? key}</div>
                  <div class="plugin-schema__value">
                    <SchemaValue schema={fieldSchema} value={value} />
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      </Match>
      <Match when={type() === 'array' && Array.isArray(props.value)}>
        <ul class="plugin-schema__array">
          <For each={props.value as unknown[]}>
            {(item) => (
              <li class="plugin-schema__array-item">
                <SchemaValue value={item} />
              </li>
            )}
          </For>
        </ul>
      </Match>
    </Switch>
  );
};

function parseNumberInput(value: string): number | null {
  if (value.trim() === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export const SchemaRenderer: Component<SchemaRendererProps> = (props) => {
  const [draftData, setDraftData] = createSignal<Record<string, unknown>>(props.data ?? {});

  createEffect(() => {
    setDraftData(props.data ?? {});
  });

  const properties = () => {
    const rawProperties = props.schema.properties;
    if (!rawProperties || typeof rawProperties !== 'object' || Array.isArray(rawProperties)) {
      return [] as Array<[string, Record<string, unknown>]>;
    }
    return Object.entries(rawProperties as Record<string, Record<string, unknown>>);
  };

  const updateValue = (key: string, value: unknown) => {
    const nextData = {
      ...draftData(),
      [key]: value,
    };
    setDraftData(nextData);
    props.onChange?.(nextData);
  };

  return (
    <section class="plugin-schema">
      <Show when={typeof props.schema.title === 'string'}>
        <h2 class="plugin-schema__title">{props.schema.title as string}</h2>
      </Show>
      <Show when={typeof props.schema.description === 'string'}>
        <p class="plugin-schema__description">{props.schema.description as string}</p>
      </Show>

      <div class="plugin-schema__fields">
        <For each={properties()}>
          {([key, fieldSchema]) => {
            const fieldType = fieldSchema.type;
            const value = () => draftData()[key];

            return (
              <div class="plugin-schema__field">
                <div class="plugin-schema__label">{(fieldSchema.title as string | undefined) ?? key}</div>
                <div class="plugin-schema__value">
                  <Switch fallback={<SchemaValue schema={fieldSchema} value={value()} />}>
                    <Match when={fieldType === 'string'}>
                      <input
                        type="text"
                        value={typeof value() === 'string' ? value() as string : ''}
                        onInput={(event) => updateValue(key, event.currentTarget.value)}
                      />
                    </Match>
                    <Match when={fieldType === 'number' || fieldType === 'integer'}>
                      <input
                        type="number"
                        value={typeof value() === 'number' ? String(value()) : ''}
                        onInput={(event) => {
                          const nextValue = parseNumberInput(event.currentTarget.value);
                          updateValue(key, nextValue ?? 0);
                        }}
                      />
                    </Match>
                    <Match when={fieldType === 'boolean'}>
                      <input
                        type="checkbox"
                        checked={value() === true}
                        onChange={(event) => updateValue(key, event.currentTarget.checked)}
                      />
                    </Match>
                  </Switch>
                </div>
              </div>
            );
          }}
        </For>
      </div>
    </section>
  );
};

export default SchemaRenderer;
