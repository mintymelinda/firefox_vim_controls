import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deflateRawSync } from "node:zlib";

const root = fileURLToPath(new URL("../", import.meta.url));
const dist = resolve(root, "dist");
const artifacts = resolve(root, "artifacts");

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

export function crc32(value) {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function createZip(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  const sorted = [...entries].sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  );

  for (const entry of sorted) {
    const normalizedName = entry.name.replaceAll("\\", "/");
    if (
      !normalizedName ||
      normalizedName.startsWith("/") ||
      normalizedName.split("/").includes("..")
    ) {
      throw new Error(`Invalid package path: ${entry.name}`);
    }
    const name = Buffer.from(normalizedName, "utf8");
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const compressed = deflateRawSync(data, { level: 9 });
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x0021, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    // Mark entries as regular Unix files with readable permissions. Firefox's
    // add-on loader extracts XPI files and must be able to read the contents.
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, name);
    localOffset += local.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

async function collectFiles(directory) {
  const entries = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const absolute = resolve(directory, item.name);
    if (item.isDirectory()) {
      entries.push(...(await collectFiles(absolute)));
    } else if (item.isFile()) {
      entries.push({
        name: relative(dist, absolute).split(sep).join("/"),
        data: await readFile(absolute),
      });
    }
  }
  return entries;
}

async function validatePackageFiles(entries) {
  const byName = new Map(entries.map((entry) => [entry.name, entry.data]));
  const manifestData = byName.get("manifest.json");
  if (!manifestData) throw new Error("Built package is missing manifest.json.");
  const manifest = JSON.parse(manifestData.toString("utf8"));
  if (
    manifest.manifest_version !== 2 ||
    !manifest.browser_specific_settings?.gecko ||
    !manifest.default_locale
  ) {
    throw new Error("Built manifest is not a supported Firefox WebExtension manifest.");
  }
  const scripts = [
    ...(manifest.background?.scripts || []),
    ...(manifest.content_scripts || []).flatMap((script) => script.js || []),
  ];
  for (const script of scripts) {
    if (!byName.has(script))
      throw new Error(`Built package is missing referenced script: ${script}`);
  }
  const locale = `_locales/${manifest.default_locale || "en"}/messages.json`;
  if (!byName.has(locale)) throw new Error(`Built package is missing default locale: ${locale}`);
  JSON.parse(byName.get(locale).toString("utf8"));
  return manifest;
}

export async function packageExtension() {
  const entries = await collectFiles(dist);
  const manifest = await validatePackageFiles(entries);
  const project = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  if (project.version !== manifest.version) {
    throw new Error("package.json and manifest.json versions must match.");
  }
  const zip = createZip(entries);
  await mkdir(artifacts, { recursive: true });
  const output = resolve(artifacts, `firefox-vim-controls-${manifest.version}.zip`);
  await writeFile(output, zip);
  return output;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  await rm(artifacts, { recursive: true, force: true });
  const output = await packageExtension();
  console.log(`Packaged Firefox extension: ${relative(root, output)}`);
}
