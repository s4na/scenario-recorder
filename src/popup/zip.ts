type ZipEntry = {
  name: string;
  text: string;
};

const encoder = new TextEncoder();
const crcTable = createCrcTable();

export function createZipBlob(entries: ZipEntry[]): Blob {
  const localFiles: Uint8Array[] = [];
  const centralDirectory: Uint8Array[] = [];
  let offset = 0;
  const date = new Date();
  const { dosTime, dosDate } = toDosDateTime(date);

  for (const entry of entries) {
    const filename = encoder.encode(entry.name);
    const data = encoder.encode(entry.text);
    const crc = crc32(data);
    const localHeader = createLocalFileHeader(filename, crc, data.length, dosTime, dosDate);
    localFiles.push(localHeader, data);
    centralDirectory.push(createCentralDirectoryHeader(filename, crc, data.length, dosTime, dosDate, offset));
    offset += localHeader.length + data.length;
  }

  const centralDirectorySize = centralDirectory.reduce((sum, item) => sum + item.length, 0);
  const end = createEndOfCentralDirectory(entries.length, centralDirectorySize, offset);
  return new Blob([...localFiles, ...centralDirectory, end].map(toBlobPart), { type: "application/zip" });
}

function toBlobPart(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function createLocalFileHeader(
  filename: Uint8Array,
  crc: number,
  size: number,
  dosTime: number,
  dosDate: number,
): Uint8Array {
  const header = new Uint8Array(30 + filename.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0x0800, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, dosTime, true);
  view.setUint16(12, dosDate, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, size, true);
  view.setUint32(22, size, true);
  view.setUint16(26, filename.length, true);
  header.set(filename, 30);
  return header;
}

function createCentralDirectoryHeader(
  filename: Uint8Array,
  crc: number,
  size: number,
  dosTime: number,
  dosDate: number,
  offset: number,
): Uint8Array {
  const header = new Uint8Array(46 + filename.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0x0800, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, dosTime, true);
  view.setUint16(14, dosDate, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, size, true);
  view.setUint32(24, size, true);
  view.setUint16(28, filename.length, true);
  view.setUint32(42, offset, true);
  header.set(filename, 46);
  return header;
}

function createEndOfCentralDirectory(
  entryCount: number,
  centralDirectorySize: number,
  centralDirectoryOffset: number,
): Uint8Array {
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, entryCount, true);
  view.setUint16(10, entryCount, true);
  view.setUint32(12, centralDirectorySize, true);
  view.setUint32(16, centralDirectoryOffset, true);
  return end;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let current = index;
    for (let bit = 0; bit < 8; bit += 1) {
      current = current & 1 ? 0xedb88320 ^ (current >>> 1) : current >>> 1;
    }
    table[index] = current >>> 0;
  }
  return table;
}

function toDosDateTime(date: Date): { dosTime: number; dosDate: number } {
  const year = Math.max(date.getFullYear(), 1980);
  return {
    dosTime: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    dosDate: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}
