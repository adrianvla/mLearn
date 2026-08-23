import { createContext, createEffect, createSignal, onCleanup, useContext, type ParentComponent } from 'solid-js';
import { getBridge } from '../../shared/bridges';
import type { GraphLookupInput, GraphMeta, GraphRelatedNode, GraphSurfaceTargets, GraphWordLookup } from '../../shared/graph/ipc';
import type { GraphRelationType } from '../../shared/graph/types';
import { useSettings } from './SettingsContext';

interface GraphContextValue {
  meta: () => GraphMeta;
  lookupWord: (input: GraphLookupInput) => Promise<GraphWordLookup | null>;
  getRelated: (entityId: string, relationTypes: GraphRelationType[]) => Promise<GraphRelatedNode[]>;
  getTargetsForSurfaces: (inputs: GraphLookupInput[]) => Promise<GraphSurfaceTargets[]>;
}

const unavailableMeta: GraphMeta = { entityCount: 0, relationCount: 0, ready: false, status: 'unavailable' };
const GraphContext = createContext<GraphContextValue>();
const unavailableGraph: GraphContextValue = {
  meta: () => unavailableMeta,
  lookupWord: async () => null,
  getRelated: async () => [],
  getTargetsForSurfaces: async () => [],
};

export const GraphProvider: ParentComponent = (props) => {
  const { settings } = useSettings();
  const [meta, setMeta] = createSignal<GraphMeta>(unavailableMeta);
  let request = 0;

  createEffect(() => {
    const language = settings.language;
    const currentRequest = ++request;
    void getBridge().graph.getGraphMeta(language).then((nextMeta) => {
      if (currentRequest === request) setMeta(nextMeta);
    }).catch(() => {
      if (currentRequest === request) setMeta({ ...unavailableMeta, status: 'error' });
    });
  });

  onCleanup(() => { request += 1; });

  const active = <T,>(query: (language: string) => Promise<T>, fallback: T): Promise<T> => (
    meta().ready ? query(settings.language) : Promise.resolve(fallback)
  );

  return (
    <GraphContext.Provider value={{
      meta,
      lookupWord: (input) => active((language) => getBridge().graph.lookupGraphWord(language, input), null),
      getRelated: (entityId, relationTypes) => active(
        (language) => getBridge().graph.getGraphRelated(language, entityId, relationTypes), [],
      ),
      getTargetsForSurfaces: (inputs) => active(
        (language) => getBridge().graph.getGraphTargetsForSurfaces(language, inputs), [],
      ),
    }}>
      {props.children}
    </GraphContext.Provider>
  );
};

export function useGraph(): GraphContextValue {
  const context = useContext(GraphContext);
  if (!context) throw new Error('useGraph must be used within a GraphProvider');
  return context;
}

/** Allows isolated read-only consumers to retain their existing behavior without a provider. */
export function useOptionalGraph(): GraphContextValue {
  return useContext(GraphContext) ?? unavailableGraph;
}
