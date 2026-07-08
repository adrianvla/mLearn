import { PYTHON_BACKEND_PORT } from '../../../shared/constants';

export function buildOcrWarmupUrl(language: string): string {
  const url = new URL(`http://127.0.0.1:${PYTHON_BACKEND_PORT}/ocr/warmup`);
  url.searchParams.set('language', language);
  return url.toString();
}

function textFormPart(boundary: string, name: string, value: string): Buffer {
  return Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
  );
}

export function buildOcrMultipartBody(options: {
  boundary: string;
  imageBuffer: Buffer;
  language: string;
}): Buffer {
  const parts: Buffer[] = [
    textFormPart(options.boundary, 'language', options.language),
  ];
  parts.push(
    Buffer.from(`--${options.boundary}\r\nContent-Disposition: form-data; name="image"; filename="test.png"\r\nContent-Type: image/png\r\n\r\n`),
    options.imageBuffer,
    Buffer.from(`\r\n--${options.boundary}--\r\n`),
  );
  return Buffer.concat(parts);
}
