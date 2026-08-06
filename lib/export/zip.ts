/**
 * Minimal ZIP writer (STORE method, no compression).
 *
 * Course packs are mostly PDFs / DOCX / PPTX, which are already compressed, so
 * deflating them buys little and would cost a dependency. Everything is built in
 * memory and returned as one Buffer — callers must keep packs well under the
 * function's memory limit (see MAX_TOTAL_BYTES in course.ts).
 *
 * Layout per entry: local file header + data, then a central directory and EOCD.
 * ZIP64 is not emitted, so a pack must stay below 4 GB and 65535 entries.
 */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS packed date/time (2-second resolution, epoch 1980). */
function dosDateTime(d: Date): { time: number; date: number } {
  const time =
    (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date =
    ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

export interface ZipEntry {
  /** Path inside the archive, forward slashes, no leading slash. */
  path: string;
  data: Buffer;
}

export function makeZip(entries: ZipEntry[], now = new Date()): Buffer {
  const { time, date } = dosDateTime(now);
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path, "utf8");
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 filename
    local.writeUInt16LE(0, 8); // method: store
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra length

    chunks.push(local, name, entry.data);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); // central directory header signature
    dir.writeUInt16LE(20, 4); // version made by
    dir.writeUInt16LE(20, 6); // version needed
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(0, 10);
    dir.writeUInt16LE(time, 12);
    dir.writeUInt16LE(date, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(size, 20);
    dir.writeUInt32LE(size, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt16LE(0, 30); // extra
    dir.writeUInt16LE(0, 32); // comment
    dir.writeUInt16LE(0, 34); // disk number
    dir.writeUInt16LE(0, 36); // internal attrs
    dir.writeUInt32LE(0, 38); // external attrs
    dir.writeUInt32LE(offset, 42); // relative offset of local header
    central.push(dir, name);

    offset += local.length + name.length + size;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // this disk
  eocd.writeUInt16LE(0, 6); // disk with central dir
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...chunks, centralBuf, eocd]);
}

/** Make a string safe as a single path segment on Windows/macOS/Linux. */
export function safeSegment(s: string, fallback = "untitled"): string {
  const cleaned = s
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .trim();
  return (cleaned || fallback).slice(0, 120);
}

/** Append " (2)", " (3)" … so no two entries collide inside the archive. */
export function uniquePath(path: string, taken: Set<string>): string {
  if (!taken.has(path.toLowerCase())) {
    taken.add(path.toLowerCase());
    return path;
  }
  const dot = path.lastIndexOf(".");
  const slash = path.lastIndexOf("/");
  const hasExt = dot > slash;
  const stem = hasExt ? path.slice(0, dot) : path;
  const ext = hasExt ? path.slice(dot) : "";
  for (let n = 2; n < 1000; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken.has(candidate.toLowerCase())) {
      taken.add(candidate.toLowerCase());
      return candidate;
    }
  }
  const last = `${stem} (dup)${ext}`;
  taken.add(last.toLowerCase());
  return last;
}
