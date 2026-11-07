// A small ZIP writer, so a bundle can be handed over as one file without any
// dependency. Writes the classic format: a local header + data per file, then a
// central directory and an end record. No ZIP64, so the whole archive must stay
// under 4 GB — far beyond anything the skill bundles.

import { deflateRawSync } from 'node:zlib';

// zlib.crc32 only arrived in Node 20/22; the skill must run on 18.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS date and time, the only timestamp the basic format has (2-second steps, local time). */
function dosDateTime(date) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const year = Math.min(Math.max(d.getFullYear(), 1980), 2107);
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const UTF8_NAMES = 0x0800; // general purpose flag bit 11: names are UTF-8
const MADE_BY_UNIX = (3 << 8) | 20; // so unzip restores ordinary file permissions
const FILE_MODE = (0o100644 << 16) >>> 0;
const MAX = 0xffffffff;

/** A safe entry name: forward slashes, no leading slash, no `..` segments. */
function entryName(name) {
  const clean = String(name).replace(/\\/g, '/').replace(/^\/+/, '');
  if (!clean || clean.split('/').some((part) => part === '..')) {
    throw new Error(`Bad zip entry name: ${name}`);
  }
  return clean;
}

/**
 * Build a zip archive in memory.
 * entries: [{ name: 'folder/file.md', data: Buffer|string, mtime?: Date }]
 */
export function zipFiles(entries) {
  if (entries.length > 0xffff) throw new Error('Too many files for one zip (over 65,535).');
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entryName(entry.name), 'utf8');
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data ?? ''), 'utf8');
    const deflated = deflateRawSync(raw);
    // Store when compressing doesn't help (already-compressed or tiny files).
    const [method, body] = deflated.length < raw.length ? [8, deflated] : [0, raw];
    const crc = crc32(raw);
    const { time, date } = dosDateTime(entry.mtime);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed: 2.0 (deflate)
    local.writeUInt16LE(UTF8_NAMES, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra field length

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(MADE_BY_UNIX, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8_NAMES, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    // extra, comment, disk number, internal attributes: all zero
    central.writeUInt32LE(FILE_MODE, 38);
    central.writeUInt32LE(offset, 42);

    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
    if (offset > MAX) throw new Error('Zip archive too large (over 4 GB).');
  }

  const centralDir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  // disk numbers: zero
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...locals, centralDir, end]);
}
