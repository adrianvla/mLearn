import { describe, expect, it } from 'vitest';
import { PYTHON_BACKEND_PORT } from '../../../shared/constants';
import { buildOcrMultipartBody, buildOcrWarmupUrl } from './ocrRequestUtils';

describe('ocrRequestUtils', () => {
  it('builds OCR warmup URL for the selected learning language', () => {
    expect(buildOcrWarmupUrl('ar')).toBe(`http://127.0.0.1:${PYTHON_BACKEND_PORT}/ocr/warmup?language=ar`);
  });

  it('builds multipart OCR body with language and turbo fields', () => {
    const body = buildOcrMultipartBody({
      boundary: 'test-boundary',
      imageBuffer: Buffer.from('png-bytes'),
      language: 'zh',
      turbo: false,
    }).toString('utf-8');

    expect(body).toContain('name="language"\r\n\r\nzh\r\n');
    expect(body).toContain('name="turbo"\r\n\r\n0\r\n');
    expect(body).toContain('name="image"; filename="test.png"');
    expect(body).toContain('png-bytes');
    expect(body.endsWith('\r\n--test-boundary--\r\n')).toBe(true);
  });
});
