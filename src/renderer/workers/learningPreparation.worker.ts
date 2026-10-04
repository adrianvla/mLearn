import { forecastLearningPreparation } from '../../shared/learningPreparation';
self.onmessage = (event: MessageEvent<Parameters<typeof forecastLearningPreparation>>) => {
  try { self.postMessage({ forecast: forecastLearningPreparation(...event.data) }); }
  catch { self.postMessage({ unavailable: true }); }
};
