import { chooseHomeLearningChoice } from '../windows/main/routes/homeLearningDecision';
self.onmessage = (event: MessageEvent<Parameters<typeof chooseHomeLearningChoice>>) => {
  try { self.postMessage({ choice: chooseHomeLearningChoice(...event.data) }); }
  catch { self.postMessage({ unavailable: true }); }
};
