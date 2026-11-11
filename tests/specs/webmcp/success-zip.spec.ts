import { test, expect } from '@playwright/test';
import { deflateRawSync } from 'node:zlib';
import { expectApplicationZipDownload, inspectApplicationZip } from '../../tools/success-zip';

// ZIP generator is independent of the production assertions, including its CRC.
function checksum(bytes: Buffer): number {
    const table = Array.from({ length: 256 }, (_, value) => {
        for (let i = 0; i < 8; i++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
        return value >>> 0;
    });
    let value = 0xffffffff;
    for (const byte of bytes) value = (value >>> 8) ^ table[(value ^ byte) & 255];
    return (value ^ 0xffffffff) >>> 0;
}
function archive(deflated: boolean, entries: Record<string, string> = {
    'original/': '',
    'original/index.html': '<!doctype html><meta charset="utf-8"><html><body>Synthetic original</body></html>',
    'original/main.js': 'window.syntheticFixture = true;',
    'original/images/icon.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
    'minify/': '',
    'minify/index.html': '<html><body>Synthetic minified</body></html>',
    'minify/main.js': 'window.syntheticFixture=true;',
}): Buffer {
    const locals: Buffer[] = [], directory: Buffer[] = [];
    let offset = 0;
    for (const [name, text] of Object.entries(entries)) {
        const filename = Buffer.from(name), plain = Buffer.from(text), packed = deflated ? deflateRawSync(plain) : plain;
        const header = Buffer.alloc(30), central = Buffer.alloc(46);
        header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(deflated ? 8 : 0, 8);
        header.writeUInt32LE(checksum(plain), 14); header.writeUInt32LE(packed.length, 18); header.writeUInt32LE(plain.length, 22); header.writeUInt16LE(filename.length, 26);
        central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(deflated ? 8 : 0, 10);
        central.writeUInt32LE(checksum(plain), 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(plain.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42);
        locals.push(header, filename, packed); directory.push(central, filename);
        offset += header.length + filename.length + packed.length;
    }
    const end = Buffer.alloc(22), cd = Buffer.concat(directory);
    end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10);
    end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, cd, end]);
}

for (const deflated of [false, true]) {
    test(`success assertions: download validator accepts completed ${deflated ? 'deflated' : 'stored'} ZIP with generated HTML`, async ({ page, context, baseURL }) => {
        const origin = new URL(baseURL!).origin;
        await context.route('**/*', route => {
            const request = route.request(), url = new URL(request.url());
            if (url.origin !== origin || request.method() !== 'GET') return route.abort('blockedbyclient');
            if (url.pathname === '/success-export.zip') return route.fulfill({ contentType: 'application/zip', headers: { 'content-disposition': 'attachment; filename="fixture_1_0.zip"' }, body: archive(deflated) });
            if (url.pathname === '/success-download') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><meta charset="utf-8"><div class="version-card">1.0<button title="DL (10PP)" onclick="document.querySelector('message-box').hidden=false">DL</button></div><message-box id="download-confirm" hidden><button onclick="location.href='/success-export.zip'">ダウンロード</button></message-box>` });
            return route.abort('blockedbyclient');
        });
        await page.goto('/success-download');
        await page.getByTitle('DL (10PP)').click();
        const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'ダウンロード' }).click()]);
        await expectApplicationZipDownload(download, 'fixture', '1.0');
    });
}

for (const [name, bytes] of [
    ['empty body', Buffer.alloc(0)],
    ['HTML error renamed to ZIP', Buffer.from('<html>Authentication required</html>')],
    ['truncated ZIP', archive(true).subarray(0, -8)],
    ['empty valid ZIP', archive(false, {})],
    ['unrelated ZIP', archive(false, { 'error.txt': 'No application output was generated' })],
    ['missing minified HTML', archive(false, { 'original/index.html': '<html>Only half the export</html>' })],
    ['empty generated HTML', archive(false, { 'original/index.html': '', 'minify/index.html': '<html>Not enough</html>' })],
] as const) {
    test(`success assertions: ZIP rejects ${name}`, () => {
        expect(() => inspectApplicationZip(bytes)).toThrow(/Application ZIP/);
    });
}

test('success assertions: ZIP content CRC mismatch fails', () => {
    const bytes = archive(false);
    // Skip the explicit directory entry, then corrupt the first HTML payload.
    bytes[(30 + Buffer.byteLength('original/')) + 30 + Buffer.byteLength('original/index.html') + 20] ^= 1;
    expect(() => inspectApplicationZip(bytes)).toThrow(/CRC/);
});

test('success assertions: failed download cannot pass using only its filename', async () => {
    let read = false;
    const failed = {
        suggestedFilename: () => 'fixture_1_0.zip', failure: async () => 'canceled',
        createReadStream: async () => { read = true; throw new Error('Must not read failed download'); },
    };
    await expect(expectApplicationZipDownload(failed as any, 'fixture', '1.0')).rejects.toThrow();
    expect(read).toBe(false);
});

for (const filename of ['wrong_1_0.zip', 'fixture_1_0.zip.html']) {
    test(`success assertions: ZIP rejects misleading filename ${filename}`, async () => {
        let read = false;
        const wrongName = {
            suggestedFilename: () => filename, failure: async () => null,
            createReadStream: async () => { read = true; throw new Error('Must not read incorrectly named download'); },
        };
        await expect(expectApplicationZipDownload(wrongName as any, 'fixture', '1.0')).rejects.toThrow();
        expect(read).toBe(false);
    });
}
