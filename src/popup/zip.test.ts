import { describe, expect, it } from "vitest";
import { createZipBlob } from "./zip";

describe("createZipBlob", () => {
  it("stores each record as a separate JSONL file", async () => {
    const zip = createZipBlob([
      { name: "first.jsonl", text: "{\"kind\":\"meta\",\"name\":\"first\"}" },
      { name: "second.jsonl", text: "{\"kind\":\"meta\",\"name\":\"second\"}" },
    ]);

    const bytes = new Uint8Array(await zip.arrayBuffer());
    const entries = readStoredEntries(bytes);

    expect(zip.type).toBe("application/zip");
    expect(entries).toEqual({
      "first.jsonl": "{\"kind\":\"meta\",\"name\":\"first\"}",
      "second.jsonl": "{\"kind\":\"meta\",\"name\":\"second\"}",
    });
  });
});

function readStoredEntries(bytes: Uint8Array): Record<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const entries: Record<string, string> = {};
  let offset = 0;
  while (offset < bytes.length - 4) {
    if (view.getUint32(offset, true) === 0x04034b50) {
      const dataLength = view.getUint32(offset + 18, true);
      const filenameLength = view.getUint16(offset + 26, true);
      const extraLength = view.getUint16(offset + 28, true);
      const nameStart = offset + 30;
      const dataStart = nameStart + filenameLength + extraLength;
      const name = decoder.decode(bytes.slice(nameStart, nameStart + filenameLength));
      entries[name] = decoder.decode(bytes.slice(dataStart, dataStart + dataLength));
      offset = dataStart + dataLength;
      continue;
    }
    offset += 1;
  }
  return entries;
}
