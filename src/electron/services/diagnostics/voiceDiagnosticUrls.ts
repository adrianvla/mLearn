import { PYTHON_BACKEND_PORT } from '../../../shared/constants';

export function backendTtsStatusUrl(language: string): string {
  const url = new URL(`http://127.0.0.1:${PYTHON_BACKEND_PORT}/voice/tts/status`);
  url.searchParams.set('language', language);
  return url.toString();
}

export function backendSttStatusUrl(language: string): string {
  const url = new URL(`http://127.0.0.1:${PYTHON_BACKEND_PORT}/voice/stt/status`);
  url.searchParams.set('language', language);
  return url.toString();
}
