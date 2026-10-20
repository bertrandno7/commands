import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import { inspectCommandZip, manifestFromCommand } from "../lib/command-package";
import { seedCommands } from "../lib/commands";
import { parseManifest } from "../lib/validation";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const seedRoot = resolve(root, "seed", "commands");
const outputRoot = resolve(root, "public", "packages");
const fixedMtime = new Date("2026-10-15T00:00:00.000Z");
const packageIndex: Record<string, { version: string; bytes: number; sha256: string }> = {};

function packageFiles(directory: string) {
  const entries: Record<string, [Uint8Array, { mtime: Date }]> = {};
  const visit = (current: string) => {
    for (const name of readdirSync(current).sort()) {
      const absolute = resolve(current, name);
      const stats = statSync(absolute);
      if (stats.isDirectory()) visit(absolute);
      else {
        const path = relative(directory, absolute).split(sep).join("/");
        entries[path] = [readFileSync(absolute), { mtime: fixedMtime }];
      }
    }
  };
  visit(directory);
  return entries;
}

for (const command of seedCommands.filter((item) => item.downloadAvailable !== false)) {
  const directory = resolve(seedRoot, command.slug);
  if (!directory.startsWith(`${seedRoot}${sep}`)) throw new Error(`Unsafe seed path: ${command.slug}`);

  const manifest = manifestFromCommand(command);
  const parsed = parseManifest(manifest);
  if (!parsed.success) throw new Error(`${command.slug}: ${parsed.errors.join("; ")}`);
  if (manifest.entrypoint.callable !== "run_command") {
    throw new Error(`${command.slug}: unexpected seed entrypoint callable`);
  }

  writeFileSync(
    resolve(directory, "command.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  const archive = zipSync(packageFiles(directory), { level: 9 });
  const archivePath = resolve(outputRoot, `${command.slug}-${command.version}.command.zip`);
  if (!archivePath.startsWith(`${outputRoot}${sep}`)) throw new Error("Unsafe archive path");
  writeFileSync(archivePath, archive);

  const bytes = new ArrayBuffer(archive.byteLength);
  new Uint8Array(bytes).set(archive);
  const inspection = inspectCommandZip(bytes, manifest);
  if (inspection.entries.length < 4) throw new Error(`${command.slug}: incomplete archive`);
  packageIndex[command.slug] = {
    version: command.version,
    bytes: archive.byteLength,
    sha256: createHash("sha256").update(archive).digest("hex"),
  };
  console.log(`✔ ${command.slug} ${archive.byteLength} bytes · ${inspection.entries.length} files`);
}

writeFileSync(
  resolve(outputRoot, "index.json"),
  `${JSON.stringify(packageIndex, null, 2)}\n`,
  "utf8",
);
