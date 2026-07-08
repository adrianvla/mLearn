import { ParentComponent } from 'solid-js';
import Layout from './Layout';

const App: ParentComponent = (props) => {
  return <Layout>{props.children}</Layout>;
};

export default App;
