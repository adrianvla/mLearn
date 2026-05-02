import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { createTempDir, type TempDir } from '../../../test/helpers/tempDir';

const mockProtocolHandlers = new Map<string, (req: Request) => Promise<Response>>();

let tempDir: TempDir;

vi.mock('electron', () => ({
  protocol: {
    handle: vi.fn((scheme: string, handler: (req: Request) => Promise<Response>) => {
      mockProtocolHandlers.set(scheme, handler);
    }),
    registerSchemesAsPrivileged: vi.fn(),
  },
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'home') return tempDir?.tmpDir ?? '/tmp/home';
      if (name === 'userData') return tempDir?.tmpDir ?? '/tmp/userData';
      return '/tmp';
    }),
    isPackaged: false,
    on: vi.fn(),
  },
}));

vi.mock('../utils/platform', () => ({
  getUserDataPath: vi.fn(() => tempDir?.tmpDir ?? '/tmp/test'),
  getAppPath: vi.fn(() => tempDir?.tmpDir ?? '/tmp/test'),
  getResourcePath: vi.fn(() => tempDir?.tmpDir ?? '/tmp/test'),
  isMac: false,
  isWindows: false,
  isLinux: true,
}));

describe('localMediaProtocol', () => {
  beforeEach(async () => {
    tempDir = createTempDir('local-media-protocol-test-');
    mockProtocolHandlers.clear();
    vi.resetModules();
  });

  afterEach(() => {
    tempDir.cleanup();
  });

  describe('registerLocalMediaScheme', () => {
    it('registers local-media as a privileged scheme', async () => {
      const { protocol } = await import('electron');
      const { registerLocalMediaScheme } = await import('./localMediaProtocol');

      registerLocalMediaScheme();

      expect(protocol.registerSchemesAsPrivileged).toHaveBeenCalledWith([
        expect.objectContaining({
          scheme: 'local-media',
          privileges: expect.objectContaining({
            secure: true,
            supportFetchAPI: true,
            stream: true,
          }),
        }),
      ]);
    });

    it('sets bypassCSP to false for security', async () => {
      const { protocol } = await import('electron');
      const { registerLocalMediaScheme } = await import('./localMediaProtocol');

      registerLocalMediaScheme();

      const call = (protocol.registerSchemesAsPrivileged as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call[0].privileges.bypassCSP).toBe(false);
    });
  });

  describe('setupLocalMediaProtocol', () => {
    it('registers a handler for the local-media scheme', async () => {
      const { protocol } = await import('electron');
      const { setupLocalMediaProtocol } = await import('./localMediaProtocol');

      setupLocalMediaProtocol();

      expect(protocol.handle).toHaveBeenCalledWith('local-media', expect.any(Function));
    });

    it('returns 404 for a file that does not exist', async () => {
      const { setupLocalMediaProtocol } = await import('./localMediaProtocol');
      setupLocalMediaProtocol();

      const handler = mockProtocolHandlers.get('local-media');
      expect(handler).toBeDefined();

      const nonExistentPath = path.join(tempDir.tmpDir, 'nonexistent.mp4');
      const response = await handler!(new Request(`local-media://${nonExistentPath}`));

      expect(response.status).toBe(404);
    });

    it('returns 403 for paths outside allowed bases', async () => {
      const { setupLocalMediaProtocol } = await import('./localMediaProtocol');
      setupLocalMediaProtocol();

      const handler = mockProtocolHandlers.get('local-media');
      expect(handler).toBeDefined();

      const response = await handler!(new Request('local-media:///etc/passwd'));
      expect(response.status).toBe(403);
    });

    it('allows linux mount paths under /mnt, /media, /run/media', async () => {
      if (process.platform !== 'linux') return;
      const { setupLocalMediaProtocol } = await import('./localMediaProtocol');
      setupLocalMediaProtocol();

      const handler = mockProtocolHandlers.get('local-media');
      expect(handler).toBeDefined();

      for (const base of ['/mnt', '/media', '/run/media']) {
        const response = await handler!(new Request(`local-media://${base}/usb-drive/video.mp4`));
        expect(response.status).not.toBe(403);
      }
    });

    it('rejects linux paths outside mount roots and user dirs', async () => {
      if (process.platform !== 'linux') return;
      const { setupLocalMediaProtocol } = await import('./localMediaProtocol');
      setupLocalMediaProtocol();

      const handler = mockProtocolHandlers.get('local-media');
      expect(handler).toBeDefined();

      for (const denied of ['/etc/shadow', '/var/log/syslog', '/proc/cpuinfo', '/root/secret']) {
        const response = await handler!(new Request(`local-media://${denied}`));
        expect(response.status).toBe(403);
      }
    });

    it('returns 200 with correct MIME type for an mp4 file', async () => {
      const { setupLocalMediaProtocol } = await import('./localMediaProtocol');
      setupLocalMediaProtocol();

      const handler = mockProtocolHandlers.get('local-media');
      expect(handler).toBeDefined();

      const videoPath = path.join(tempDir.tmpDir, 'video.mp4');
      fs.writeFileSync(videoPath, Buffer.alloc(100, 'a'));

      const response = await handler!(new Request(`local-media://${videoPath}`));

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('video/mp4');
      expect(response.headers.get('Content-Length')).toBe('100');
      expect(response.headers.get('Accept-Ranges')).toBe('bytes');
    });

    it('returns 200 with correct MIME type for an mp3 file', async () => {
      const { setupLocalMediaProtocol } = await import('./localMediaProtocol');
      setupLocalMediaProtocol();

      const handler = mockProtocolHandlers.get('local-media');
      expect(handler).toBeDefined();

      const audioPath = path.join(tempDir.tmpDir, 'audio.mp3');
      fs.writeFileSync(audioPath, Buffer.alloc(50, 'b'));

      const response = await handler!(new Request(`local-media://${audioPath}`));

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('audio/mpeg');
    });

    it('returns 200 with octet-stream for unknown extensions', async () => {
      const { setupLocalMediaProtocol } = await import('./localMediaProtocol');
      setupLocalMediaProtocol();

      const handler = mockProtocolHandlers.get('local-media');
      expect(handler).toBeDefined();

      const unknownPath = path.join(tempDir.tmpDir, 'file.xyz');
      fs.writeFileSync(unknownPath, Buffer.alloc(10, 'c'));

      const response = await handler!(new Request(`local-media://${unknownPath}`));

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('application/octet-stream');
    });

    it('handles Range requests and returns 206 partial content', async () => {
      const { setupLocalMediaProtocol } = await import('./localMediaProtocol');
      setupLocalMediaProtocol();

      const handler = mockProtocolHandlers.get('local-media');
      expect(handler).toBeDefined();

      const videoPath = path.join(tempDir.tmpDir, 'range-video.mp4');
      fs.writeFileSync(videoPath, Buffer.alloc(1000, 'd'));

      const request = new Request(`local-media://${videoPath}`, {
        headers: { Range: 'bytes=0-499' },
      });

      const response = await handler!(request);

      expect(response.status).toBe(206);
      expect(response.headers.get('Content-Range')).toBe('bytes 0-499/1000');
      expect(response.headers.get('Content-Length')).toBe('500');
      expect(response.headers.get('Accept-Ranges')).toBe('bytes');
      expect(response.headers.get('Content-Type')).toBe('video/mp4');
    });

    it('handles Range requests with open-ended end byte', async () => {
      const { setupLocalMediaProtocol } = await import('./localMediaProtocol');
      setupLocalMediaProtocol();

      const handler = mockProtocolHandlers.get('local-media');
      expect(handler).toBeDefined();

      const videoPath = path.join(tempDir.tmpDir, 'range-open.mp4');
      fs.writeFileSync(videoPath, Buffer.alloc(200, 'e'));

      const request = new Request(`local-media://${videoPath}`, {
        headers: { Range: 'bytes=100-' },
      });

      const response = await handler!(request);

      expect(response.status).toBe(206);
      expect(response.headers.get('Content-Range')).toBe('bytes 100-199/200');
      expect(response.headers.get('Content-Length')).toBe('100');
    });

    it('handles URL-encoded paths correctly', async () => {
      const { setupLocalMediaProtocol } = await import('./localMediaProtocol');
      setupLocalMediaProtocol();

      const handler = mockProtocolHandlers.get('local-media');
      expect(handler).toBeDefined();

      const dir = path.join(tempDir.tmpDir, 'sub dir');
      fs.mkdirSync(dir, { recursive: true });
      const videoPath = path.join(dir, 'my video.mp4');
      fs.writeFileSync(videoPath, Buffer.alloc(50, 'f'));

      const encodedPath = encodeURIComponent(videoPath).replace(/%2F/g, '/');
      const response = await handler!(new Request(`local-media://${encodedPath}`));

      expect(response.status).toBe(200);
    });

    it('returns correct MIME types for various media extensions', async () => {
      const { setupLocalMediaProtocol } = await import('./localMediaProtocol');
      setupLocalMediaProtocol();

      const handler = mockProtocolHandlers.get('local-media');
      expect(handler).toBeDefined();

      const extensions: Array<[string, string]> = [
        ['video.webm', 'video/webm'],
        ['video.mkv', 'video/x-matroska'],
        ['audio.ogg', 'audio/ogg'],
        ['audio.wav', 'audio/wav'],
        ['image.png', 'image/png'],
        ['image.jpg', 'image/jpeg'],
        ['image.webp', 'image/webp'],
      ];

      for (const [filename, expectedMime] of extensions) {
        const filePath = path.join(tempDir.tmpDir, filename);
        fs.writeFileSync(filePath, Buffer.alloc(10, 'g'));

        const response = await handler!(new Request(`local-media://${filePath}`));

        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe(expectedMime);
      }
    });
  });

  describe('toLocalMediaUrl', () => {
    it('encodes a file path to a local-media URL', async () => {
      const { toLocalMediaUrl } = await import('./localMediaProtocol');

      const filePath = '/home/user/videos/myvideo.mp4';
      const url = toLocalMediaUrl(filePath);

      expect(url).toBe(`local-media://${encodeURIComponent(filePath)}`);
    });

    it('preserves the scheme correctly', async () => {
      const { toLocalMediaUrl } = await import('./localMediaProtocol');

      const url = toLocalMediaUrl('/some/path/file.mkv');

      expect(url.startsWith('local-media://')).toBe(true);
    });

    it('handles Windows-style paths', async () => {
      const { toLocalMediaUrl } = await import('./localMediaProtocol');

      const url = toLocalMediaUrl('C:/Users/user/video.mp4');

      expect(url).toBe('local-media://C%3A%2FUsers%2Fuser%2Fvideo.mp4');
    });

    it('handles paths with spaces', async () => {
      const { toLocalMediaUrl } = await import('./localMediaProtocol');

      const filePath = '/home/user/my videos/great video.mp4';
      const url = toLocalMediaUrl(filePath);

      expect(url).toBe(`local-media://${encodeURIComponent(filePath)}`);
    });
  });

  describe('pluginUiProtocol', () => {
    it('registers plugin-ui as a privileged scheme with CSP enforcement intact', async () => {
      const { protocol } = await import('electron');
      const { registerPluginUiScheme } = await import('./localMediaProtocol');

      registerPluginUiScheme();

      expect(protocol.registerSchemesAsPrivileged).toHaveBeenCalledWith([
        expect.objectContaining({
          scheme: 'plugin-ui',
          privileges: expect.objectContaining({
            secure: true,
            supportFetchAPI: true,
            bypassCSP: false,
          }),
        }),
      ]);
    });

    it('serves javascript modules from the plugins directory', async () => {
      const { setupPluginUiProtocol } = await import('./localMediaProtocol');
      setupPluginUiProtocol();

      const handler = mockProtocolHandlers.get('plugin-ui');
      expect(handler).toBeDefined();

      const pluginsDir = path.join(tempDir.tmpDir, 'plugins', 'demo.plugin', 'dist');
      fs.mkdirSync(pluginsDir, { recursive: true });
      const modulePath = path.join(pluginsDir, 'window.js');
      fs.writeFileSync(modulePath, 'export default function Demo() { return "ok"; }');

      const response = await handler!(new Request('plugin-ui://demo.plugin/dist/window.js'));

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('text/javascript');
      expect(await response.text()).toContain('export default function Demo');
    });

    it('resolves encoded plugin ids to the matching plugin directory', async () => {
      const { setupPluginUiProtocol } = await import('./localMediaProtocol');
      setupPluginUiProtocol();

      const handler = mockProtocolHandlers.get('plugin-ui');
      expect(handler).toBeDefined();

      const pluginsDir = path.join(tempDir.tmpDir, 'plugins', 'demo#plugin', 'dist');
      fs.mkdirSync(pluginsDir, { recursive: true });
      const modulePath = path.join(pluginsDir, 'window.js');
      fs.writeFileSync(modulePath, 'export default function EncodedDemo() { return "ok"; }');

      const response = await handler!(new Request('plugin-ui://demo%23plugin/dist/window.js'));

      expect(response.status).toBe(200);
      expect(await response.text()).toContain('EncodedDemo');
    });

    it('rejects plugin-ui paths outside the plugins directory', async () => {
      const { setupPluginUiProtocol } = await import('./localMediaProtocol');
      setupPluginUiProtocol();

      const handler = mockProtocolHandlers.get('plugin-ui');
      expect(handler).toBeDefined();

      const response = await handler!(new Request('plugin-ui://../../outside.js'));
      expect(response.status).toBe(403);
    });

    it('does not expose another plugin bundle through a different plugin id scope', async () => {
      const { setupPluginUiProtocol } = await import('./localMediaProtocol');
      setupPluginUiProtocol();

      const handler = mockProtocolHandlers.get('plugin-ui');
      expect(handler).toBeDefined();

      const pluginOneDir = path.join(tempDir.tmpDir, 'plugins', 'demo.plugin', 'dist');
      const pluginTwoDir = path.join(tempDir.tmpDir, 'plugins', 'other.plugin', 'dist');
      fs.mkdirSync(pluginOneDir, { recursive: true });
      fs.mkdirSync(pluginTwoDir, { recursive: true });
      const foreignModulePath = path.join(pluginTwoDir, 'window.js');
      fs.writeFileSync(foreignModulePath, 'export default 1;');

      const response = await handler!(new Request('plugin-ui://demo.plugin/dist/window.js'));

      expect(response.status).toBe(404);
    });
  });
});
