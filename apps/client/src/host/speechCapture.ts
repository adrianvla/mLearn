export type Utterance = { readonly audio: string; readonly mime: string };

export type Playback = {
  /** Resolves with how much of the audio was heard (0..1) and whether it finished. */
  readonly done: Promise<{ readonly fraction: number; readonly completed: boolean }>;
  readonly stop: () => void;
};

/** Microphone and speaker for speech. Voice-activity detection ends an utterance after silence. */
export type SpeechHost = {
  /** Records one utterance; resolves null if nothing was said before `signal` aborts. */
  readonly listen: (options: { readonly signal: AbortSignal; readonly onLevel?: (level: number) => void }) => Promise<Utterance | null>;
  /** Calls `onSpeech` once when the learner starts talking (barge-in), until `signal` aborts. */
  readonly watchForSpeech: (signal: AbortSignal, onSpeech: () => void) => Promise<void>;
  readonly play: (audio: string, mime: string) => Playback;
};

const START_LEVEL = 0.04;
const START_MS = 150;
const END_SILENCE_MS = 900;
const MAX_UTTERANCE_MS = 15_000;

function level(analyser: AnalyserNode, samples: Float32Array<ArrayBuffer>) {
  analyser.getFloatTimeDomainData(samples);
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

async function microphone() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const context = new AudioContext();
  // A context created after an async gap starts suspended in WebKit and reads silence.
  if (context.state === 'suspended') await context.resume();
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  context.createMediaStreamSource(stream).connect(analyser);
  const release = () => { for (const track of stream.getTracks()) track.stop(); void context.close(); };
  return { stream, analyser, samples: new Float32Array(analyser.fftSize), release };
}

function base64(bytes: Uint8Array) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

export function createBrowserSpeech(): SpeechHost | undefined {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return undefined;
  return {
    async listen({ signal, onLevel }) {
      const input = await microphone();
      // Ending the call while permission was pending must not leave the microphone open.
      if (signal.aborted) { input.release(); return null; }
      try {
        const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type)) ?? '';
        const recorder = new MediaRecorder(input.stream, mime ? { mimeType: mime } : undefined);
        const chunks: Blob[] = [];
        recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
        const stopped = new Promise<void>(resolve => { recorder.onstop = () => resolve(); });
        recorder.start(250);
        const spoke = await new Promise<boolean>(resolve => {
          let loud = 0, silent = 0, talking = false, began = 0;
          const timer = setInterval(() => {
            const value = level(input.analyser, input.samples);
            onLevel?.(Math.min(1, value / (START_LEVEL * 4)));
            if (value >= START_LEVEL) { loud += 50; silent = 0; } else { silent += 50; loud = 0; }
            if (!talking && loud >= START_MS) { talking = true; began = performance.now(); }
            if (talking && (silent >= END_SILENCE_MS || performance.now() - began >= MAX_UTTERANCE_MS)) { finish(true); }
          }, 50);
          const finish = (value: boolean) => { clearInterval(timer); signal.removeEventListener('abort', aborted); resolve(value); };
          const aborted = () => finish(false);
          signal.addEventListener('abort', aborted, { once: true });
        });
        recorder.stop();
        await stopped;
        if (!spoke) return null;
        const blob = new Blob(chunks, { type: recorder.mimeType || mime || 'audio/webm' });
        return { audio: base64(new Uint8Array(await blob.arrayBuffer())), mime: blob.type.split(';')[0] };
      } finally { input.release(); }
    },
    async watchForSpeech(signal, onSpeech) {
      const input = await microphone();
      if (signal.aborted) { input.release(); return; }
      await new Promise<void>(resolve => {
        let loud = 0;
        const timer = setInterval(() => {
          loud = level(input.analyser, input.samples) >= START_LEVEL ? loud + 50 : 0;
          if (loud >= START_MS) { done(); onSpeech(); }
        }, 50);
        const done = () => { clearInterval(timer); signal.removeEventListener('abort', done); input.release(); resolve(); };
        signal.addEventListener('abort', done, { once: true });
      });
    },
    play(audio, mime) {
      const element = new Audio(`data:${mime};base64,${audio}`);
      let settle: (value: { fraction: number; completed: boolean }) => void = () => {};
      const done = new Promise<{ fraction: number; completed: boolean }>(resolve => { settle = resolve; });
      const fraction = () => element.duration > 0 && Number.isFinite(element.duration) ? Math.min(1, element.currentTime / element.duration) : 0;
      element.onended = () => settle({ fraction: 1, completed: true });
      element.onerror = () => settle({ fraction: fraction(), completed: false });
      void element.play().catch(() => settle({ fraction: 0, completed: false }));
      return { done, stop: () => { element.pause(); settle({ fraction: fraction(), completed: false }); } };
    },
  };
}
