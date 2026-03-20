// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLoad = vi.fn().mockResolvedValue(undefined);
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockExec = vi.fn().mockResolvedValue(0);
const mockReadFile = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
const mockDeleteFile = vi.fn().mockResolvedValue(undefined);

vi.mock('@ffmpeg/ffmpeg', () => {
  class FFmpegMock {
    loaded = false;
    load = mockLoad;
    writeFile = mockWriteFile;
    exec = mockExec;
    readFile = mockReadFile;
    deleteFile = mockDeleteFile;
  }
  return { FFmpeg: FFmpegMock };
});

vi.mock('@ffmpeg/util', () => ({
  fetchFile: vi.fn().mockResolvedValue(new Uint8Array([10, 20, 30])),
  toBlobURL: vi.fn().mockImplementation((url: string) => Promise.resolve(`blob:${url}`)),
}));

vi.mock('@ffmpeg/core?url', () => ({ default: 'mock-core.js' }));
vi.mock('@ffmpeg/core/wasm?url', () => ({ default: 'mock-core.wasm' }));

vi.mock('../../shared/bridges', () => ({
  getBridge: vi.fn(),
}));

vi.mock('../../shared/platform', () => ({
  isDesktop: vi.fn(),
}));

const mockReadMediaFile = vi.fn();

describe('videoClipService', () => {
  beforeEach(async () => {
    vi.resetModules();

    mockLoad.mockReset();
    mockWriteFile.mockReset();
    mockExec.mockReset();
    mockReadFile.mockReset();
    mockDeleteFile.mockReset();
    mockReadMediaFile.mockReset();

    mockLoad.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockExec.mockResolvedValue(0);
    mockReadFile.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
    mockDeleteFile.mockResolvedValue(undefined);

    const { getBridge } = await import('../../shared/bridges');
    vi.mocked(getBridge).mockReturnValue({
      files: { readMediaFile: mockReadMediaFile },
    } as unknown as ReturnType<typeof getBridge>);

    const { isDesktop } = await import('../../shared/platform');
    vi.mocked(isDesktop).mockReturnValue(true);
  });

  describe('clipVideo - stream copy success path', () => {
    it('returns Uint8Array on successful stream copy', async () => {
      const { fetchFile } = await import('@ffmpeg/util');
      vi.mocked(fetchFile).mockResolvedValue(new Uint8Array([10, 20, 30]));

      const { clipVideo } = await import('./videoClipService');
      const result = await clipVideo('https://example.com/video.mp4', 1, 5);

      expect(result).toBeInstanceOf(Uint8Array);
      expect(mockExec).toHaveBeenCalled();
      expect(mockReadFile).toHaveBeenCalledWith('output.mp4');
    });

    it('writes input file with correct extension', async () => {
      const { fetchFile } = await import('@ffmpeg/util');
      vi.mocked(fetchFile).mockResolvedValue(new Uint8Array([5, 6, 7]));

      const { clipVideo } = await import('./videoClipService');
      await clipVideo('https://example.com/clip.mkv', 0, 3);

      expect(mockWriteFile).toHaveBeenCalledWith('input.mkv', expect.any(Uint8Array));
    });

    it('defaults to mp4 extension when url has no extension', async () => {
      const { fetchFile } = await import('@ffmpeg/util');
      vi.mocked(fetchFile).mockResolvedValue(new Uint8Array([1, 2]));

      const { clipVideo } = await import('./videoClipService');
      await clipVideo('https://example.com/stream', 0, 2);

      expect(mockWriteFile).toHaveBeenCalledWith('input.mp4', expect.any(Uint8Array));
    });

    it('cleans up temp files after success', async () => {
      const { fetchFile } = await import('@ffmpeg/util');
      vi.mocked(fetchFile).mockResolvedValue(new Uint8Array([1]));

      const { clipVideo } = await import('./videoClipService');
      await clipVideo('https://example.com/v.mp4', 0, 1);

      expect(mockDeleteFile).toHaveBeenCalledWith('input.mp4');
      expect(mockDeleteFile).toHaveBeenCalledWith('output.mp4');
    });

    it('passes correct start and end timestamps to exec', async () => {
      const { fetchFile } = await import('@ffmpeg/util');
      vi.mocked(fetchFile).mockResolvedValue(new Uint8Array([1]));

      const { clipVideo } = await import('./videoClipService');
      await clipVideo('https://example.com/v.mp4', 2.5, 7.8);

      const execArgs = mockExec.mock.calls[0][0] as string[];
      expect(execArgs).toContain('2.500');
      expect(execArgs).toContain('7.800');
    });

    it('clamps start to 0 when negative', async () => {
      const { fetchFile } = await import('@ffmpeg/util');
      vi.mocked(fetchFile).mockResolvedValue(new Uint8Array([1]));

      const { clipVideo } = await import('./videoClipService');
      await clipVideo('https://example.com/v.mp4', -5, 3);

      const execArgs = mockExec.mock.calls[0][0] as string[];
      expect(execArgs).toContain('0.000');
    });
  });

  describe('clipVideo - fallback re-encode path', () => {
    it('falls back to re-encode when stream copy returns non-zero exit code', async () => {
      const { fetchFile } = await import('@ffmpeg/util');
      vi.mocked(fetchFile).mockResolvedValue(new Uint8Array([1, 2]));
      mockExec
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0);

      const { clipVideo } = await import('./videoClipService');
      const result = await clipVideo('https://example.com/v.mp4', 0, 2);

      expect(mockExec).toHaveBeenCalledTimes(2);
      const reEncodeArgs = mockExec.mock.calls[1][0] as string[];
      expect(reEncodeArgs).toContain('libx264');
      expect(result).toBeInstanceOf(Uint8Array);
    });

    it('returns null when both stream copy and re-encode fail', async () => {
      const { fetchFile } = await import('@ffmpeg/util');
      vi.mocked(fetchFile).mockResolvedValue(new Uint8Array([1]));
      mockExec.mockResolvedValue(1);

      const { clipVideo } = await import('./videoClipService');
      const result = await clipVideo('https://example.com/v.mp4', 0, 2);

      expect(result).toBeNull();
    });
  });

  describe('clipVideo - local-media:// scheme', () => {
    it('reads file via bridge for local-media:// URLs', async () => {
      mockReadMediaFile.mockResolvedValue(new ArrayBuffer(10));

      const { clipVideo } = await import('./videoClipService');
      const result = await clipVideo('local-media:///home/user/video.mp4', 0, 2);

      expect(mockReadMediaFile).toHaveBeenCalledWith('/home/user/video.mp4');
      expect(result).toBeInstanceOf(Uint8Array);
    });

    it('returns null when readMediaFile returns null', async () => {
      mockReadMediaFile.mockResolvedValue(null);

      const { clipVideo } = await import('./videoClipService');
      const result = await clipVideo('local-media:///missing.mp4', 0, 2);

      expect(result).toBeNull();
    });
  });

  describe('clipVideo - file size limits', () => {
    it('returns null when file exceeds desktop size limit (1.5 GB)', async () => {
      const { isDesktop } = await import('../../shared/platform');
      vi.mocked(isDesktop).mockReturnValue(true);

      const { fetchFile } = await import('@ffmpeg/util');
      const largeBuffer = new Uint8Array(1.6 * 1024 * 1024 * 1024);
      vi.mocked(fetchFile).mockResolvedValue(largeBuffer);

      const { clipVideo } = await import('./videoClipService');
      const result = await clipVideo('https://example.com/big.mp4', 0, 5);

      expect(result).toBeNull();
      expect(mockExec).not.toHaveBeenCalled();
    });

    it('returns null when file exceeds mobile size limit (512 MB)', async () => {
      const { isDesktop } = await import('../../shared/platform');
      vi.mocked(isDesktop).mockReturnValue(false);

      const { fetchFile } = await import('@ffmpeg/util');
      const largeBuffer = new Uint8Array(600 * 1024 * 1024);
      vi.mocked(fetchFile).mockResolvedValue(largeBuffer);

      const { clipVideo } = await import('./videoClipService');
      const result = await clipVideo('https://example.com/big.mp4', 0, 5);

      expect(result).toBeNull();
      expect(mockExec).not.toHaveBeenCalled();
    });
  });

  describe('clipVideo - error handling', () => {
    it('returns null when fetchFile throws', async () => {
      const { fetchFile } = await import('@ffmpeg/util');
      vi.mocked(fetchFile).mockRejectedValue(new Error('Network error'));

      const { clipVideo } = await import('./videoClipService');
      const result = await clipVideo('https://example.com/v.mp4', 0, 2);

      expect(result).toBeNull();
    });

    it('returns null when readFile returns a string', async () => {
      const { fetchFile } = await import('@ffmpeg/util');
      vi.mocked(fetchFile).mockResolvedValue(new Uint8Array([1]));
      mockReadFile.mockResolvedValue('unexpected string result');

      const { clipVideo } = await import('./videoClipService');
      const result = await clipVideo('https://example.com/v.mp4', 0, 2);

      expect(result).toBeNull();
    });

    it('returns null when ffmpeg load fails', async () => {
      mockLoad.mockRejectedValue(new Error('WASM load failed'));
      const { fetchFile } = await import('@ffmpeg/util');
      vi.mocked(fetchFile).mockResolvedValue(new Uint8Array([1]));

      const { clipVideo } = await import('./videoClipService');
      const result = await clipVideo('https://example.com/v.mp4', 0, 2);

      expect(result).toBeNull();
    });
  });
});
