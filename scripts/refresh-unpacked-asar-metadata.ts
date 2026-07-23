import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const ASAR_BLOCK_SIZE = 4 * 1024 * 1024;

interface AsarIntegrity {
  algorithm: "SHA256";
  hash: string;
  blockSize: number;
  blocks: string[];
}

interface AsarFileEntry {
  size: number;
  unpacked: true;
  executable?: true;
  integrity: AsarIntegrity;
}

interface AsarDirectoryEntry {
  files: Record<string, AsarEntry>;
}

interface AsarLinkEntry {
  link: string;
  unpacked: true;
}

type AsarEntry = AsarDirectoryEntry | AsarFileEntry | AsarLinkEntry;

export interface AsarHeader {
  files: Record<string, AsarEntry>;
}

function alignToUInt32(value: number): number {
  return value + ((4 - (value % 4)) % 4);
}

export function decodeAsarArchive(archive: Buffer): {
  header: AsarHeader;
  packedPayload: Buffer;
} {
  if (archive.length < 16) throw new Error("ASAR archive is too small.");
  const headerSize = archive.readUInt32LE(4);
  const headerEnd = 8 + headerSize;
  if (headerEnd > archive.length || headerSize < 8) {
    throw new Error("ASAR archive has an invalid header size.");
  }

  const headerPickle = archive.subarray(8, headerEnd);
  const jsonLength = headerPickle.readUInt32LE(4);
  const jsonEnd = 8 + jsonLength;
  if (jsonEnd > headerPickle.length) throw new Error("ASAR archive has an invalid JSON header.");

  const header = JSON.parse(headerPickle.subarray(8, jsonEnd).toString("utf8")) as AsarHeader;
  if (!header || typeof header !== "object" || !header.files) {
    throw new Error("ASAR archive is missing its root file table.");
  }
  return { header, packedPayload: archive.subarray(headerEnd) };
}

export function encodeAsarArchive(header: AsarHeader, packedPayload: Buffer): Buffer {
  const json = Buffer.from(JSON.stringify(header), "utf8");
  const payloadSize = 4 + alignToUInt32(json.length);
  const headerPickle = Buffer.alloc(4 + payloadSize);
  headerPickle.writeUInt32LE(payloadSize, 0);
  headerPickle.writeUInt32LE(json.length, 4);
  json.copy(headerPickle, 8);

  const sizePickle = Buffer.alloc(8);
  sizePickle.writeUInt32LE(4, 0);
  sizePickle.writeUInt32LE(headerPickle.length, 4);
  return Buffer.concat([sizePickle, headerPickle, packedPayload]);
}

function fileIntegrity(contents: Buffer): AsarIntegrity {
  const blocks: string[] = [];
  for (let offset = 0; offset < contents.length; offset += ASAR_BLOCK_SIZE) {
    blocks.push(
      NodeCrypto.createHash("sha256")
        .update(contents.subarray(offset, Math.min(contents.length, offset + ASAR_BLOCK_SIZE)))
        .digest("hex"),
    );
  }
  return {
    algorithm: "SHA256",
    hash: NodeCrypto.createHash("sha256").update(contents).digest("hex"),
    blockSize: ASAR_BLOCK_SIZE,
    blocks,
  };
}

async function readUnpackedDirectory(directory: string): Promise<AsarDirectoryEntry> {
  const files: Record<string, AsarEntry> = {};
  const entries = await NodeFSP.readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const entryPath = NodePath.join(directory, entry.name);
    if (entry.isDirectory()) {
      files[entry.name] = await readUnpackedDirectory(entryPath);
      continue;
    }
    if (entry.isSymbolicLink()) {
      files[entry.name] = { link: await NodeFSP.readlink(entryPath), unpacked: true };
      continue;
    }
    if (!entry.isFile()) throw new Error(`Unsupported ASAR entry: ${entryPath}`);

    const [contents, stat] = await Promise.all([
      NodeFSP.readFile(entryPath),
      NodeFSP.stat(entryPath),
    ]);
    files[entry.name] = {
      size: contents.length,
      unpacked: true,
      ...(stat.mode & 0o111 ? { executable: true } : {}),
      integrity: fileIntegrity(contents),
    };
  }
  return { files };
}

function replaceDirectoryEntry(
  header: AsarHeader,
  relativeDirectory: string,
  replacement: AsarDirectoryEntry,
): void {
  const segments = relativeDirectory.split("/").filter(Boolean);
  if (
    segments.length === 0 ||
    NodePath.isAbsolute(relativeDirectory) ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error(`Invalid unpacked ASAR directory: ${relativeDirectory}`);
  }

  let files = header.files;
  for (const segment of segments.slice(0, -1)) {
    const entry = files[segment];
    if (!entry || !("files" in entry)) {
      throw new Error(`ASAR archive does not contain directory: ${segment}`);
    }
    files = entry.files;
  }
  files[segments.at(-1)!] = replacement;
}

export async function refreshUnpackedAsarMetadata(
  archivePath: string,
  relativeDirectory: string,
): Promise<void> {
  const physicalDirectory = NodePath.join(`${archivePath}.unpacked`, relativeDirectory);
  const [archive, archiveStat, replacement] = await Promise.all([
    NodeFSP.readFile(archivePath),
    NodeFSP.stat(archivePath),
    readUnpackedDirectory(physicalDirectory),
  ]);
  const { header, packedPayload } = decodeAsarArchive(archive);
  replaceDirectoryEntry(header, relativeDirectory, replacement);

  const temporaryArchive = `${archivePath}.metadata-${process.pid}.tmp`;
  await NodeFSP.writeFile(temporaryArchive, encodeAsarArchive(header, packedPayload), {
    mode: archiveStat.mode,
  });
  await NodeFSP.rename(temporaryArchive, archivePath);
}

async function main(): Promise<void> {
  const archivePath = process.argv[2];
  const relativeDirectory = process.argv[3];
  if (!archivePath || !relativeDirectory) {
    throw new Error(
      "Usage: node scripts/refresh-unpacked-asar-metadata.ts <app.asar> <relative-directory>",
    );
  }
  await refreshUnpackedAsarMetadata(NodePath.resolve(archivePath), relativeDirectory);
}

if (process.argv[1] && import.meta.url === NodeURL.pathToFileURL(process.argv[1]).href) {
  await main();
}
