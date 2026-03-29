import { ErrorBoundary, type JSX, type ParentComponent } from 'solid-js';

interface PluginErrorBoundaryProps {
  pluginName: string;
  children: JSX.Element;
}

export const PluginErrorBoundary: ParentComponent<PluginErrorBoundaryProps> = (props) => {
  return (
    <ErrorBoundary
      fallback={(error) => (
        <div class="plugin-host__error" role="alert" aria-live="assertive">
          <h2>Plugin UI failed to load</h2>
          <p>{props.pluginName}</p>
          <p>{error instanceof Error ? error.message : String(error)}</p>
        </div>
      )}
    >
      {props.children}
    </ErrorBoundary>
  );
};

export default PluginErrorBoundary;
