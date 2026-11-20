import test from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { createZip, crc32 } from "../scripts/package.mjs";

test("calculates standard CRC-32 checksums", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
});

test("creates deterministic ZIP archives with readable file entries", () => {
  const entries = [
    { name: "src/entry.js", data: Buffer.from("console.log('ok');") },
    { name: "manifest.json", data: Buffer.from("{}") },
  ];
  const zip = createZip(entries);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
  assert.equal(zip.equals(createZip(entries)), true);
  assert.equal(zip.includes(Buffer.from("manifest.json")), true);

  const nameLength = zip.readUInt16LE(26);
  const compressedLength = zip.readUInt32LE(18);
  const payloadStart = 30 + nameLength;
  const payload = inflateRawSync(zip.subarray(payloadStart, payloadStart + compressedLength));
  assert.equal(payload.toString("utf8"), "{}");
});
