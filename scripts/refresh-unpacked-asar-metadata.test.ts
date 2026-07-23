import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  decodeAsarArchive,
  encodeAsarArchive,
  refreshUnpackedAsarMetadata,
  type AsarHeader,
} from "./refresh-unpacked-asar-metadata.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => NodeFSP.rm(directory, { recursive: true, force: true })),
  );
});

describe("refreshUnpackedAsarMetadata", () => {
  it("replaces unpacked client metadata while preserving packed bytes", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-asar-metadata-test-"));
    temporaryDirectories.push(root);
    const archivePath = NodePath.join(root, "app.asar");
    const clientPath = `${archivePath}.unpacked/apps/server/dist/client`;
    await NodeFSP.mkdir(NodePath.join(clientPath, "assets"), { recursive: true });
    await NodeFSP.writeFile(
      NodePath.join(clientPath, "index.html"),
      '<script src="/assets/new.js"></script>',
    );
    await NodeFSP.writeFile(
      NodePath.join(clientPath, "assets/new.js"),
      "export const current = true;\n",
    );

    const header: AsarHeader = {
      files: {
        apps: {
          files: {
            server: {
              files: {
                dist: {
                  files: {
                    client: {
                      files: {
                        "index.html": {
                          size: 3,
                          unpacked: true,
                          integrity: {
                            algorithm: "SHA256",
                            hash: "old",
                            blockSize: 4 * 1024 * 1024,
                            blocks: ["old"],
                          },
                        },
                        assets: { files: { "old.js": { files: {} } } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
    const packedPayload = Buffer.from("packed-runtime-bytes");
    await NodeFSP.writeFile(archivePath, encodeAsarArchive(header, packedPayload));

    await refreshUnpackedAsarMetadata(archivePath, "apps/server/dist/client");

    const refreshed = decodeAsarArchive(await NodeFSP.readFile(archivePath));
    expect(refreshed.packedPayload).toEqual(packedPayload);
    const apps = refreshed.header.files.apps;
    expect(apps).toHaveProperty("files");
    if (!(apps && "files" in apps)) throw new Error("Missing apps directory");
    const server = apps.files.server;
    if (!(server && "files" in server)) throw new Error("Missing server directory");
    const dist = server.files.dist;
    if (!(dist && "files" in dist)) throw new Error("Missing dist directory");
    const client = dist.files.client;
    if (!(client && "files" in client)) throw new Error("Missing client directory");
    expect(Object.keys(client.files)).toEqual(["assets", "index.html"]);
    expect(Object.keys((client.files.assets as { files: Record<string, unknown> }).files)).toEqual([
      "new.js",
    ]);
    expect(client.files["index.html"]).toMatchObject({
      size: 38,
      unpacked: true,
      integrity: {
        algorithm: "SHA256",
        hash: NodeCrypto.createHash("sha256")
          .update('<script src="/assets/new.js"></script>')
          .digest("hex"),
      },
    });
  });
});
