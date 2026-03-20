// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetDocument = vi.fn();

vi.mock('./pdf.mjs', () => ({
  default: undefined,
}));

function setWindowPdfjs(lib: unknown) {
  (window as unknown as { pdfjsLib: unknown }).pdfjsLib = lib;
}

function deleteWindowPdfjs() {
  delete (window as unknown as { pdfjsLib?: unknown }).pdfjsLib;
}

function makeMockPage(width = 100, height = 200) {
  return {
    getViewport: vi.fn().mockReturnValue({ width, height }),
    render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
  };
}

function setupMockPdf(pages: ReturnType<typeof makeMockPage>[]) {
  const mockPdf = {
    numPages: pages.length,
    getPage: vi.fn().mockImplementation(async (i: number) => pages[i - 1]),
    cleanup: vi.fn(),
  };
  mockGetDocument.mockReturnValue({ promise: Promise.resolve(mockPdf) });
  return mockPdf;
}

function setupCanvas(blobResult: Blob | null = new Blob(['img'], { type: 'image/png' })) {
  const mockCtx = {};
  const mockCanvas = {
    getContext: vi.fn().mockReturnValue(mockCtx),
    toBlob: vi.fn().mockImplementation((cb: (b: Blob | null) => void) => cb(blobResult)),
    width: 0,
    height: 0,
  };
  vi.spyOn(document, 'createElement').mockReturnValue(mockCanvas as unknown as HTMLElement);
  return { mockCanvas, mockCtx };
}

describe('pdfService', () => {
  beforeEach(() => {
    vi.resetModules();
    mockGetDocument.mockReset();

    setWindowPdfjs({
      GlobalWorkerOptions: { workerSrc: '' },
      getDocument: mockGetDocument,
    });
  });

  describe('isPdfFile', () => {
    it('returns true for a file with .pdf extension', async () => {
      const { isPdfFile } = await import('./pdfService');
      const file = new File([''], 'document.pdf', { type: 'text/plain' });
      expect(isPdfFile(file)).toBe(true);
    });

    it('returns true for a file with .PDF uppercase extension', async () => {
      const { isPdfFile } = await import('./pdfService');
      const file = new File([''], 'DOCUMENT.PDF', { type: 'text/plain' });
      expect(isPdfFile(file)).toBe(true);
    });

    it('returns true for a file with application/pdf type regardless of name', async () => {
      const { isPdfFile } = await import('./pdfService');
      const file = new File([''], 'no-extension', { type: 'application/pdf' });
      expect(isPdfFile(file)).toBe(true);
    });

    it('returns false for a non-pdf file with a different extension', async () => {
      const { isPdfFile } = await import('./pdfService');
      const file = new File([''], 'image.png', { type: 'image/png' });
      expect(isPdfFile(file)).toBe(false);
    });

    it('returns false for a .pdfx extension', async () => {
      const { isPdfFile } = await import('./pdfService');
      const file = new File([''], 'document.pdfx', { type: 'text/plain' });
      expect(isPdfFile(file)).toBe(false);
    });

    it('returns false for a file with no extension and no pdf type', async () => {
      const { isPdfFile } = await import('./pdfService');
      const file = new File([''], 'readme', { type: 'text/plain' });
      expect(isPdfFile(file)).toBe(false);
    });
  });

  describe('containsPdf', () => {
    it('returns the first pdf file found in the array', async () => {
      const { containsPdf } = await import('./pdfService');
      const png = new File([''], 'image.png', { type: 'image/png' });
      const pdf = new File([''], 'doc.pdf', { type: 'application/pdf' });
      expect(containsPdf([png, pdf])).toBe(pdf);
    });

    it('returns null when no pdf file is present', async () => {
      const { containsPdf } = await import('./pdfService');
      const png = new File([''], 'image.png', { type: 'image/png' });
      expect(containsPdf([png])).toBeNull();
    });

    it('returns null for an empty array', async () => {
      const { containsPdf } = await import('./pdfService');
      expect(containsPdf([])).toBeNull();
    });

    it('returns the first pdf when multiple pdfs are present', async () => {
      const { containsPdf } = await import('./pdfService');
      const pdf1 = new File([''], 'first.pdf', { type: 'application/pdf' });
      const pdf2 = new File([''], 'second.pdf', { type: 'application/pdf' });
      expect(containsPdf([pdf1, pdf2])).toBe(pdf1);
    });
  });

  describe('pdfToImages', () => {
    it('returns one PageImage per page', async () => {
      const { pdfToImages } = await import('./pdfService');
      setupCanvas();
      setupMockPdf([makeMockPage(), makeMockPage()]);
      const file = new File(['%PDF'], 'test.pdf', { type: 'application/pdf' });
      const images = await pdfToImages(file);
      expect(images).toHaveLength(2);
    });

    it('page name is zero-padded with page number', async () => {
      const { pdfToImages } = await import('./pdfService');
      setupCanvas();
      setupMockPdf([makeMockPage()]);
      const file = new File(['%PDF'], 'test.pdf', { type: 'application/pdf' });
      const images = await pdfToImages(file);
      expect(images[0].name).toBe('page-001.png');
    });

    it('index property is 0-based', async () => {
      const { pdfToImages } = await import('./pdfService');
      setupCanvas();
      setupMockPdf([makeMockPage(), makeMockPage()]);
      const file = new File(['%PDF'], 'test.pdf', { type: 'application/pdf' });
      const images = await pdfToImages(file);
      expect(images[0].index).toBe(0);
      expect(images[1].index).toBe(1);
    });

    it('source defaults to filename without extension', async () => {
      const { pdfToImages } = await import('./pdfService');
      setupCanvas();
      setupMockPdf([makeMockPage()]);
      const file = new File(['%PDF'], 'mybook.pdf', { type: 'application/pdf' });
      const images = await pdfToImages(file);
      expect(images[0].source).toBe('mybook');
    });

    it('source uses provided sourceName option', async () => {
      const { pdfToImages } = await import('./pdfService');
      setupCanvas();
      setupMockPdf([makeMockPage()]);
      const file = new File(['%PDF'], 'test.pdf', { type: 'application/pdf' });
      const images = await pdfToImages(file, { sourceName: 'Custom Source' });
      expect(images[0].source).toBe('Custom Source');
    });

    it('passes scale option to getViewport', async () => {
      const { pdfToImages } = await import('./pdfService');
      const page = makeMockPage();
      setupCanvas();
      setupMockPdf([page]);
      const file = new File(['%PDF'], 'test.pdf', { type: 'application/pdf' });
      await pdfToImages(file, { scale: 3 });
      expect(page.getViewport).toHaveBeenCalledWith({ scale: 3 });
    });

    it('defaults scale to 2 when not provided', async () => {
      const { pdfToImages } = await import('./pdfService');
      const page = makeMockPage();
      setupCanvas();
      setupMockPdf([page]);
      const file = new File(['%PDF'], 'test.pdf', { type: 'application/pdf' });
      await pdfToImages(file);
      expect(page.getViewport).toHaveBeenCalledWith({ scale: 2 });
    });

    it('each image has a url from URL.createObjectURL', async () => {
      const { pdfToImages } = await import('./pdfService');
      setupCanvas();
      setupMockPdf([makeMockPage()]);
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
      const file = new File(['%PDF'], 'test.pdf', { type: 'application/pdf' });
      const images = await pdfToImages(file);
      expect(images[0].url).toBe('blob:mock-url');
    });

    it('calls pdf.cleanup after rendering all pages', async () => {
      const { pdfToImages } = await import('./pdfService');
      setupCanvas();
      const mockPdf = setupMockPdf([makeMockPage()]);
      const file = new File(['%PDF'], 'test.pdf', { type: 'application/pdf' });
      await pdfToImages(file);
      expect(mockPdf.cleanup).toHaveBeenCalledOnce();
    });

    it('does not throw when pdf.cleanup throws', async () => {
      const { pdfToImages } = await import('./pdfService');
      setupCanvas();
      const mockPdf = setupMockPdf([makeMockPage()]);
      mockPdf.cleanup.mockImplementation(() => { throw new Error('cleanup fail'); });
      const file = new File(['%PDF'], 'test.pdf', { type: 'application/pdf' });
      await expect(pdfToImages(file)).resolves.toBeDefined();
    });

    it('throws when canvas.toBlob returns null', async () => {
      const { pdfToImages } = await import('./pdfService');
      setupCanvas(null);
      setupMockPdf([makeMockPage()]);
      const file = new File(['%PDF'], 'test.pdf', { type: 'application/pdf' });
      await expect(pdfToImages(file)).rejects.toThrow('Failed to create blob from canvas');
    });

    it('throws when canvas 2D context is unavailable', async () => {
      const { pdfToImages } = await import('./pdfService');
      setupMockPdf([makeMockPage()]);
      const noCtxCanvas = {
        getContext: vi.fn().mockReturnValue(null),
        toBlob: vi.fn(),
        width: 0,
        height: 0,
      };
      vi.spyOn(document, 'createElement').mockReturnValue(noCtxCanvas as unknown as HTMLElement);
      const file = new File(['%PDF'], 'test.pdf', { type: 'application/pdf' });
      await expect(pdfToImages(file)).rejects.toThrow('Failed to get canvas 2D context');
    });

    it('returns empty array for a PDF with zero pages', async () => {
      const { pdfToImages } = await import('./pdfService');
      const mockPdf = {
        numPages: 0,
        getPage: vi.fn(),
        cleanup: vi.fn(),
      };
      mockGetDocument.mockReturnValue({ promise: Promise.resolve(mockPdf) });
      const file = new File(['%PDF'], 'empty.pdf', { type: 'application/pdf' });
      const images = await pdfToImages(file);
      expect(images).toEqual([]);
    });

    it('passes getDocument options that disable worker fetch and auto fetch', async () => {
      const { pdfToImages } = await import('./pdfService');
      setupCanvas();
      setupMockPdf([makeMockPage()]);
      const file = new File(['%PDF'], 'test.pdf', { type: 'application/pdf' });
      await pdfToImages(file);
      expect(mockGetDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          useWorkerFetch: false,
          isEvalSupported: false,
          disableAutoFetch: true,
        }),
      );
    });
  });

  describe('getPdfJs', () => {
    it('throws when window.pdfjsLib is not set', async () => {
      deleteWindowPdfjs();
      const { pdfToImages } = await import('./pdfService');
      const file = new File(['%PDF'], 'test.pdf', { type: 'application/pdf' });
      await expect(pdfToImages(file)).rejects.toThrow('pdf.js library not loaded');
    });

    it('sets GlobalWorkerOptions.workerSrc to empty string on first use', async () => {
      const pdfjsLib = {
        GlobalWorkerOptions: { workerSrc: 'some-worker.js' },
        getDocument: mockGetDocument,
      };
      setWindowPdfjs(pdfjsLib);
      setupCanvas();
      const emptyPdf = { numPages: 0, getPage: vi.fn(), cleanup: vi.fn() };
      mockGetDocument.mockReturnValue({ promise: Promise.resolve(emptyPdf) });
      const { pdfToImages } = await import('./pdfService');
      const file = new File(['%PDF'], 'test.pdf', { type: 'application/pdf' });
      await pdfToImages(file);
      expect(pdfjsLib.GlobalWorkerOptions.workerSrc).toBe('');
    });
  });
});
