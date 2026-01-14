import { createSignal, onMount } from 'solid-js';
import Button from './components/general/Button/Button';

function App() {
  const [version, setVersion] = createSignal<string>('Loading...');

  onMount(async () => {
    // Check if running in Electron
    if (window.electronAPI) {
      const v = await window.electronAPI.getVersion();
      setVersion(v);
    } else {
      setVersion('Browser Mode');
    }
  });

  const handlePing = () => {
    if (window.electronAPI) {
      window.electronAPI.sendMessage('Ping from SolidJS!');
      console.log('Message sent via IPC');
    } else {
      console.log('IPC not available in browser mode');
    }
  };

  return (
    <div style={{ padding: '20px' }}>
      <h1>Electron + Vite + SolidJS</h1>
      <p>Current Version: {version()}</p>
      
      <div style={{ "margin-top": '20px' }}>
        <p>Example of a component with scoped CSS:</p>
        <Button onClick={handlePing}>Send IPC Message</Button>
      </div>
    </div>
  );
}

export default App;
