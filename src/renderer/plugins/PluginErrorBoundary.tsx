import { ErrorBoundary, type JSX, type ParentComponent } from 'solid-js';
import { PluginLoadError } from './PluginLoadError';

interface PluginErrorBoundaryProps {
  pluginName: string;
  children: JSX.Element;
}

export const PluginErrorBoundary: ParentComponent<PluginErrorBoundaryProps> = (props) => {
  return (
    <ErrorBoundary
      fallback={(error) => (
        <PluginLoadError
          pluginName={props.pluginName}
          message={error instanceof Error ? error.message : String(error)}
        />
      )}
    >
      {props.children}
    </ErrorBoundary>
  );
};

export default PluginErrorBoundary;
