import { createRoot } from 'solid-js';
import { useLowPowerGate } from './LowPowerGateContext';

vi.mock('./LowPowerGateContext.css', () => ({}));

it('useLowPowerGate returns an object with requestAccess and isActive', () => {
  createRoot((dispose) => {
    const gate = useLowPowerGate();
    expect(typeof gate.requestAccess).toBe('function');
    expect(typeof gate.isActive).toBe('function');
    dispose();
  });
});

it('useLowPowerGate isActive() returns false when no provider', () => {
  createRoot((dispose) => {
    const gate = useLowPowerGate();
    expect(gate.isActive()).toBe(false);
    dispose();
  });
});

it('useLowPowerGate requestAccess("llm") resolves to true when no provider', async () => {
  let result: boolean | undefined;
  await new Promise<void>((done) => {
    createRoot(async (dispose) => {
      const gate = useLowPowerGate();
      result = await gate.requestAccess('llm');
      dispose();
      done();
    });
  });
  expect(result).toBe(true);
});

it('useLowPowerGate requestAccess("tts") resolves to true when no provider', async () => {
  let result: boolean | undefined;
  await new Promise<void>((done) => {
    createRoot(async (dispose) => {
      const gate = useLowPowerGate();
      result = await gate.requestAccess('tts');
      dispose();
      done();
    });
  });
  expect(result).toBe(true);
});

it('useLowPowerGate requestAccess("ocr") resolves to true when no provider', async () => {
  let result: boolean | undefined;
  await new Promise<void>((done) => {
    createRoot(async (dispose) => {
      const gate = useLowPowerGate();
      result = await gate.requestAccess('ocr');
      dispose();
      done();
    });
  });
  expect(result).toBe(true);
});
