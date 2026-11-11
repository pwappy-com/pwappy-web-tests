import { expect, type Download } from '@playwright/test';
import { inflateRawSync } from 'node:zlib';

// Normal generated application exports use stored/deflated, single-disk ZIPs.
// Keep untrusted downloaded bytes bounded and in memory; never extract/run them.
const MAX_BYTES = 256 * 1024 * 1024;
const crc32 = (bytes: Buffer): number => {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
};
const requireZip = (condition: boolean, message: string): void => {
    if (!condition) throw new Error(`Application ZIP: ${message}`);
};

export function inspectApplicationZip(bytes: Buffer): string[] {
    requireZip(bytes.length >= 22 && bytes.length <= MAX_BYTES, 'empty, truncated or oversized archive');
    let end = -1;
    for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 22 - 65535); offset--) {
        if (bytes.readUInt32LE(offset) === 0x06054b50 && offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length) {
            end = offset;
            break;
        }
    }
    requireZip(end >= 0, 'end-of-central-directory record is missing');
    const count = bytes.readUInt16LE(end + 10);
    const centralSize = bytes.readUInt32LE(end + 12);
    const centralStart = bytes.readUInt32LE(end + 16);
    requireZip(bytes.readUInt16LE(end + 4) === 0 && bytes.readUInt16LE(end + 6) === 0 && bytes.readUInt16LE(end + 8) === count, 'multi-disk archive is unsupported');
    requireZip(count > 0 && count < 0xffff && centralSize !== 0xffffffff && centralStart !== 0xffffffff, 'empty or ZIP64 archive is unsupported');
    requireZip(centralStart + centralSize === end, 'central-directory size/offset is invalid');

    const files = new Map<string, Buffer>();
    let cursor = centralStart;
    let totalUnpacked = 0;
    for (let index = 0; index < count; index++) {
        requireZip(cursor + 46 <= end && bytes.readUInt32LE(cursor) === 0x02014b50, 'central-directory entry is invalid');
        const flags = bytes.readUInt16LE(cursor + 8);
        const method = bytes.readUInt16LE(cursor + 10);
        const crc = bytes.readUInt32LE(cursor + 16);
        const packedSize = bytes.readUInt32LE(cursor + 20);
        const unpackedSize = bytes.readUInt32LE(cursor + 24);
        const nameSize = bytes.readUInt16LE(cursor + 28);
        const extraSize = bytes.readUInt16LE(cursor + 30);
        const commentSize = bytes.readUInt16LE(cursor + 32);
        const local = bytes.readUInt32LE(cursor + 42);
        requireZip(cursor + 46 + nameSize + extraSize + commentSize <= end, 'truncated central-directory entry');
        const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameSize);
        const name = nameBytes.toString('utf8');
        requireZip(name.length > 0 && !files.has(name) && !name.includes('\0') && !name.startsWith('/') && !name.split(/[\\/]/).includes('..'), 'unsafe or duplicate entry name');
        requireZip((flags & 1) === 0 && (method === 0 || method === 8), 'encrypted or unsupported compression');
        requireZip(bytes.readUInt16LE(cursor + 34) === 0, 'nonzero entry disk');
        requireZip(local + 30 <= centralStart && bytes.readUInt32LE(local) === 0x04034b50, 'local entry header is invalid');
        const localNameSize = bytes.readUInt16LE(local + 26);
        const localExtraSize = bytes.readUInt16LE(local + 28);
        const dataStart = local + 30 + localNameSize + localExtraSize;
        requireZip(dataStart + packedSize <= centralStart, 'truncated entry data');
        requireZip(bytes.readUInt16LE(local + 6) === flags && bytes.readUInt16LE(local + 8) === method && bytes.subarray(local + 30, local + 30 + localNameSize).equals(nameBytes), 'local/central entry mismatch');
        totalUnpacked += unpackedSize;
        requireZip(totalUnpacked <= MAX_BYTES, 'uncompressed content exceeds safety limit');
        const packed = bytes.subarray(dataStart, dataStart + packedSize);
        const content = method === 0 ? packed : inflateRawSync(packed, { maxOutputLength: Math.max(1, unpackedSize) });
        requireZip(content.length === unpackedSize && crc32(content) === crc, `invalid content size or CRC for ${name}`);
        files.set(name, content);
        cursor += 46 + nameSize + extraSize + commentSize;
    }
    requireZip(cursor === end, 'central-directory entry count does not match');
    // UserProjectService::createDownloadWebFiles emits both versions, not a lone
    // error page renamed to .zip or an unrelated otherwise-valid archive.
    for (const name of ['original/index.html', 'minify/index.html']) {
        const content = files.get(name);
        requireZip(!!content?.length && /<html(?:\s|>)/i.test(content.toString('utf8')), `missing generated HTML: ${name}`);
    }
    return [...files.keys()];
}

export async function expectApplicationZipDownload(download: Download, appKey: string, version: string): Promise<void> {
    const filename = download.suggestedFilename();
    expect(filename).toContain(`${appKey.replace(/\./g, '_')}_${version.replace(/\./g, '_')}`);
    expect(filename).toMatch(/\.zip$/i);
    expect(await download.failure(), 'Download must complete successfully').toBeNull();
    const stream = await download.createReadStream();
    if (!stream) throw new Error('Application ZIP: downloaded bytes are unavailable');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of stream) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        requireZip(size <= MAX_BYTES, 'download exceeds safety limit');
        chunks.push(bytes);
    }
    inspectApplicationZip(Buffer.concat(chunks));
}
