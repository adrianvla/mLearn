export interface TempDir {
    tmpDir: string;
    cleanup: () => void;
}
export declare function createTempDir(prefix?: string): TempDir;
export declare function ensureDir(dirPath: string): void;
//# sourceMappingURL=tempDir.d.ts.map