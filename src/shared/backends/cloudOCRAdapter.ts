import { getLogger } from '../utils/logger';

const log = getLogger("shared.backends.cloudOCR");
/**
 * Cloud OCR Adapter
 *
 * Handles OCR via the BFF Worker's HATEOAS job flow:
 * 1. POST /api/ocr/jobs → get upload URL + job ID
 * 2. Upload image to signed Supabase Storage URL
 * 3. POST /api/ocr/jobs/:jobId/trigger → start processing
 * 4. Poll GET /api/ocr/jobs/:jobId until completed
 */

interface OCRJobCreateResponse {
  jobId: string;
  token: string;
  actions: {
    upload_image: string;
    trigger_job: string;
    listen_channel: string;
  };
}

interface OCRJobStatus {
  job: {
    id: string;
    type: string;
    status: 'pending_upload' | 'processing' | 'completed' | 'failed';
    input_params: Record<string, unknown>;
    result: OCRJobResult | null;
    error: string | null;
    created_at: string;
    updated_at: string;
    completed_at: string | null;
  };
}

interface OCRJobResult {
  text: string;
  boxes?: Array<{
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
    confidence?: number;
  }>;
}

export class CloudOCRAdapter {
  private readonly baseUrl: string;
  private readonly authToken: string;

  constructor(baseUrl: string, authToken: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.authToken = authToken;
  }

  /**
   * Submit an image for OCR via the cloud HATEOAS job flow.
   * Returns OCR result with text and bounding boxes.
   */
  async recognize(
    imageBlob: Blob,
    language: string,
    engine?: string,
  ): Promise<OCRJobResult> {
    // Step 1: Create job
    const createRes = await fetch(`${this.baseUrl}/api/ocr/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.authToken}`,
      },
      body: JSON.stringify({
        language,
        engine: engine ?? undefined,
        imageFormat: this.detectFormat(imageBlob),
      }),
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      throw new Error(`Cloud OCR job creation failed: ${createRes.status} ${errText}`);
    }

    const jobData = (await createRes.json()) as OCRJobCreateResponse;

    // Step 2: Upload image to signed URL
    const uploadRes = await fetch(jobData.actions.upload_image, {
      method: 'PUT',
      headers: {
        'Content-Type': imageBlob.type || 'image/png',
      },
      body: imageBlob,
    });

    if (!uploadRes.ok) {
      throw new Error(`Cloud OCR image upload failed: ${uploadRes.status}`);
    }

    // Step 3: Trigger processing
    const triggerRes = await fetch(jobData.actions.trigger_job, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.authToken}`,
      },
    });

    if (!triggerRes.ok) {
      const errText = await triggerRes.text();
      throw new Error(`Cloud OCR trigger failed: ${triggerRes.status} ${errText}`);
    }

    // Step 4: Poll for completion
    return this.pollJobResult(jobData.jobId);
  }

  /**
   * Poll the job status until completed or failed.
   * Uses exponential backoff starting at 500ms, max 30s total wait.
   */
  private async pollJobResult(jobId: string): Promise<OCRJobResult> {
    const maxWaitMs = 60_000;
    const startTime = Date.now();
    let delay = 500;

    while (Date.now() - startTime < maxWaitMs) {
      const res = await fetch(`${this.baseUrl}/api/ocr/jobs/${jobId}`, {
        headers: {
          'Authorization': `Bearer ${this.authToken}`,
        },
      });

      if (!res.ok) {
        throw new Error(`Cloud OCR job poll failed: ${res.status}`);
      }

      const data = (await res.json()) as OCRJobStatus;
      const { status, result, error } = data.job;

      if (status === 'completed' && result) {
        return result;
      }

      if (status === 'failed') {
        throw new Error(`Cloud OCR failed: ${error || 'Unknown error'}`);
      }

      // Wait before next poll with exponential backoff
      await new Promise<void>((resolve) => {
        const id = setTimeout(resolve, delay);
        // Ensure cleanup if this promise is GC'd (defensive)
        void id;
      });
      delay = Math.min(delay * 1.5, 4000);
    }

    throw new Error('Cloud OCR timed out waiting for result');
  }

  /** Check if the cloud OCR endpoint is reachable */
  async checkAvailability(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${this.baseUrl}/api/health`, {
        headers: { 'Authorization': `Bearer ${this.authToken}` },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return res.ok;
    } catch (e) {
      log.error("error", e);
      return false;
    }
  }

  private detectFormat(blob: Blob): string {
    const type = blob.type;
    if (type.includes('jpeg') || type.includes('jpg')) return 'jpg';
    if (type.includes('webp')) return 'webp';
    return 'png';
  }
}
