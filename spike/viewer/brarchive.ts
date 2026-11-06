// The client's packed resource folders (resource_packs\vanilla\__brarchive\*.brarchive): an
// 8-byte magic, a 32-bit count and version, then `count` 256-byte entries (a name length byte, the
// name padded to 247 bytes, the 32-bit offset and size of its data), then the data, which starts
// right after the entries. Offsets count from there.

export interface ArchiveEntry {
  name: string;
  data: Buffer;
}

const ENTRY = 256;
const HEADER = 16;

export function readArchive(file: Buffer): ArchiveEntry[] {
  const count = file.readUInt32LE(8);
  const start = HEADER + count * ENTRY;
  const entries: ArchiveEntry[] = [];
  for (let i = 0; i < count; i++) {
    const at = HEADER + i * ENTRY;
    const length = file[at];
    const name = file.toString("utf8", at + 1, at + 1 + length);
    const offset = file.readUInt32LE(at + 248);
    const size = file.readUInt32LE(at + 252);
    entries.push({ name, data: file.subarray(start + offset, start + offset + size) });
  }
  return entries;
}
