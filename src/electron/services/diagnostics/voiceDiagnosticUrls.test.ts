import { describe, expect, it } from 'vitest';
import { PYTHON_BACKEND_PORT } from '../../../shared/constants';
import { backendSttStatusUrl, backendTtsStatusUrl } from './voiceDiagnosticUrls';

describe('voice diagnostic urls', () => {
  it('targets TTS status for the selected learning language', () => {
    expect(backendTtsStatusUrl('fa')).toBe(
      `http://127.0.0.1:${PYTHON_BACKEND_PORT}/voice/tts/status?language=fa`,
    );
  });

  it('targets STT status for the selected learning language', () => {
    expect(backendSttStatusUrl('ar')).toBe(
      `http://127.0.0.1:${PYTHON_BACKEND_PORT}/voice/stt/status?language=ar`,
    );
  });
});
