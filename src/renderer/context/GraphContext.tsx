import { createContext, createEffect, createSignal, onCleanup, useContext, type ParentComponent } from 'solid-js';
import { getBridge } from '../../shared/bridges';
import type { GraphLookupInput, GraphMeta, GraphNeighborhood, GraphNeighborhoodQuery, GraphRelatedNode, GraphSurfaceTargets, GraphWordLookup } from '../../shared/graph/ipc';
import type { GraphRelationType } from '../../shared/graph/types';
import { useSettings } from './SettingsContext';

interface GraphContextValue {
  meta: () => GraphMeta;
  /** True while the active-language graph probe is in flight. The initial
   * meta reads 'unavailable' purely as a placeholder — consumers must show a
   * loading state, not the not-installed/degraded contract, until this clears. */
  metaLoading: () => boolean;
  lookupWord: (input: GraphLookupInput) => Promise<GraphWordLookup | null>;
  getRelated: (entityId: string, relationTypes: GraphRelationType[]) => Promise<GraphRelatedNode[]>;
  getTargetsForSurfaces: (inputs: GraphLookupInput[]) => Promise<GraphSurfaceTargets[]>;
  getNeighborhood: (query: GraphNeighborhoodQuery) => Promise<GraphNeighborhood | null>;
};
const unavailableMeta: GraphMeta = { entityCount: 0, relationCount: 0, ready: false, status: 'unavailable' };
const GraphContext = createContext<GraphContextValue>();
const unavailableGraph: GraphContextValue = {
  meta: () => unavailableMeta,
  metaLoading: () => false,
  lookupWord: async () => null,
  getRelated: async () => [],
  getTargetsForSurfaces: async () => [],
  getNeighborhood: async () => null,
};

export const GraphProvider: ParentComponent = (props) => {
  const { settings } = useSettings();
  const [meta, setMeta] = createSignal<GraphMeta>(unavailableMeta);
  const [metaLoading, setMetaLoading] = createSignal(true);
  let request = 0;

  createEffect(() => {
    const language = settings.language;
    const currentRequest = ++request;
    setMetaLoading(true);
    void getBridge().graph.getGraphMeta(language).then((nextMeta) => {
      if (currentRequest === request) {
        setMeta(nextMeta);
        setMetaLoading(false);
      }
    }).catch(() => {
      if (currentRequest === request) {
        setMeta({ ...unavailableMeta, status: 'error' });
        setMetaLoading(false);
      }
    });
  });

  onCleanup(() => { request += 1; });

  const active = <T,>(query: (language: string) => Promise<T>, fallback: T): Promise<T> => (
    meta().ready ? query(settings.language) : Promise.resolve(fallback)
  );

  return (
    <GraphContext.Provider value={{
      meta,
      metaLoading,
      lookupWord: (input) => active((language) => getBridge().graph.lookupGraphWord(language, input), null),
      getRelated: (entityId, relationTypes) => active(
        (language) => getBridge().graph.getGraphRelated(language, entityId, relationTypes), [],
      ),
      getTargetsForSurfaces: (inputs) => active(
        (language) => getBridge().graph.getGraphTargetsForSurfaces(language, inputs), [],
      ),
      getNeighborhood: (query) => active(
        (language) => getBridge().graph.getGraphNeighborhood(language, query), null,
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
