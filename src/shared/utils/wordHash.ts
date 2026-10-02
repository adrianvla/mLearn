/** Canonical UTF-8 SHA-256 identities shared by storage and renderer consumers. */
export async function hashWord(word: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(word);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Pure-JS SHA-256 — used by hashWordSync so synchronous callers produce the
// same 64-char lowercase hex as hashWord() / Node's crypto.createHash.
// Based on the FIPS 180-4 reference implementation; no external dependencies.
// ---------------------------------------------------------------------------
const SHA256_K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256Sync(message: string): string {
    const encoder = new TextEncoder();
    const msgBytes = encoder.encode(message);
    const msgLen = msgBytes.length;
    const bitLen = msgLen * 8;

    // Pad to 512-bit blocks: append 0x80, then zeros, then 64-bit big-endian length
    const padLen = ((msgLen + 9 + 63) & ~63);
    const padded = new Uint8Array(padLen);
    padded.set(msgBytes);
    padded[msgLen] = 0x80;
    // Write 64-bit big-endian bit length (JS numbers are 53-bit safe so high word is 0)
    const dv = new DataView(padded.buffer);
    dv.setUint32(padLen - 4, bitLen >>> 0, false);
    dv.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000), false);

    // Initial hash values (first 32 bits of fractional parts of square roots of first 8 primes)
    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

    const w = new Uint32Array(64);
    const blocks = padLen / 64;

    for (let i = 0; i < blocks; i++) {
        const off = i * 64;
        for (let j = 0; j < 16; j++) {
            w[j] = dv.getUint32(off + j * 4, false);
        }
        for (let j = 16; j < 64; j++) {
            const s0 = (w[j - 15] >>> 7 | w[j - 15] << 25) ^ (w[j - 15] >>> 18 | w[j - 15] << 14) ^ (w[j - 15] >>> 3);
            const s1 = (w[j - 2] >>> 17 | w[j - 2] << 15) ^ (w[j - 2] >>> 19 | w[j - 2] << 13) ^ (w[j - 2] >>> 10);
            w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0;
        }

        let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;

        for (let j = 0; j < 64; j++) {
            const S1 = (e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7);
            const ch = (e & f) ^ (~e & g);
            const temp1 = (h + S1 + ch + SHA256_K[j] + w[j]) >>> 0;
            const S0 = (a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = (S0 + maj) >>> 0;

            h = g; g = f; f = e; e = (d + temp1) >>> 0;
            d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
        }

        h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
        h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
    }

    const result = new Uint32Array([h0, h1, h2, h3, h4, h5, h6, h7]);
    return Array.from(result).map(n => n.toString(16).padStart(8, '0')).join('');
}

/**
 * Synchronous word hash using the same SHA-256 algorithm as hashWord().
 * Produces a 64-char lowercase hex string — identical output to hashWord().
 * Use for performance-sensitive synchronous paths (rendering, hover tracking).
 */
export function hashWordSync(word: string): string {
    // Pure function of its input, called repeatedly for the same surface
    // forms across resolution paths (knowledge status, projection, tracking).
    // The bounded memo keeps the SHA-256 cost O(unique words) instead of
    // O(hash calls) on rendering-heavy surfaces.
    const cached = hashWordSyncCache.get(word);
    if (cached !== undefined) return cached;
    const hash = sha256Sync(word);
    if (hashWordSyncCache.size >= HASH_SYNC_CACHE_MAX) {
        const oldest = hashWordSyncCache.keys().next().value;
        if (oldest !== undefined) hashWordSyncCache.delete(oldest);
    }
    hashWordSyncCache.set(word, hash);
    return hash;
}

const HASH_SYNC_CACHE_MAX = 10_000;
const hashWordSyncCache = new Map<string, string>();
