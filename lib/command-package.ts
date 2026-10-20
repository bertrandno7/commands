import type { CommandRecord } from "@/lib/commands";
import type { CommandManifest } from "@/lib/validation";
import { isSafePackagePath, parseManifest } from "@/lib/validation";
import { unzipSync } from "fflate";

export const PACKAGE_LIMITS = {
  compressedBytes: 10 * 1024 * 1024,
  expandedBytes: 50 * 1024 * 1024,
  files: 100,
  maxCompressionRatio: 200,
} as const;

export type ZipEntry = {
  path: string;
  crc32: number;
  compressedBytes: number;
  expandedBytes: number;
  compressionMethod: number;
  directory: boolean;
};

export type PackageInspection = {
  entries: ZipEntry[];
  compressedBytes: number;
  expandedBytes: number;
  readme: string;
};

export class PackageValidationError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "PackageValidationError";
  }
}

/**
 * Reads the ZIP central directory without executing or extracting user code.
 * ZIP64, encrypted entries, symlinks, path traversal, and unusual compression
 * methods are deliberately rejected for V1.
 */
export function inspectCommandZip(
  bytes: ArrayBuffer,
  manifest: CommandManifest,
): PackageInspection {
  if (bytes.byteLength > PACKAGE_LIMITS.compressedBytes) {
    throw new PackageValidationError(
      `Package exceeds ${PACKAGE_LIMITS.compressedBytes} compressed bytes.`,
      "package_too_large",
    );
  }

  const view = new DataView(bytes);
  const end = findEndOfCentralDirectory(view);
  const diskNumber = view.getUint16(end + 4, true);
  const centralDisk = view.getUint16(end + 6, true);
  const entriesOnDisk = view.getUint16(end + 8, true);
  const entryCount = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  const centralOffset = view.getUint32(end + 16, true);

  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new PackageValidationError(
      "Multi-disk ZIP archives are not supported.",
      "unsupported_zip",
    );
  }
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new PackageValidationError(
      "ZIP64 archives are not supported.",
      "unsupported_zip64",
    );
  }
  if (entryCount > PACKAGE_LIMITS.files) {
    throw new PackageValidationError(
      `Package contains more than ${PACKAGE_LIMITS.files} entries.`,
      "too_many_files",
    );
  }
  if (centralOffset + centralSize > end || centralOffset < 0) {
    throw new PackageValidationError(
      "ZIP central directory is outside the archive bounds.",
      "invalid_zip",
    );
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries: ZipEntry[] = [];
  const paths = new Set<string>();
  const portablePaths = new Set<string>();
  let cursor = centralOffset;
  let expandedBytes = 0;
  let compressedEntryBytes = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > view.byteLength || view.getUint32(cursor, true) !== 0x02014b50) {
      throw new PackageValidationError(
        "ZIP central directory entry is malformed.",
        "invalid_zip",
      );
    }

    const madeBy = view.getUint16(cursor + 4, true);
    const flags = view.getUint16(cursor + 8, true);
    const compressionMethod = view.getUint16(cursor + 10, true);
    const compressedBytes = view.getUint32(cursor + 20, true);
    const entryExpandedBytes = view.getUint32(cursor + 24, true);
    const crc32 = view.getUint32(cursor + 16, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const externalAttributes = view.getUint32(cursor + 38, true);
    const nextCursor = cursor + 46 + nameLength + extraLength + commentLength;
    if (nextCursor > view.byteLength || nameLength === 0) {
      throw new PackageValidationError("ZIP filename is malformed.", "invalid_zip");
    }

    let path: string;
    try {
      path = decoder.decode(
        new Uint8Array(bytes, cursor + 46, nameLength),
      );
    } catch {
      throw new PackageValidationError(
        "ZIP filenames must be valid UTF-8.",
        "invalid_filename",
      );
    }

    const directory = path.endsWith("/");
    const pathToValidate = directory ? path.slice(0, -1) : path;
    if (!isSafePackagePath(pathToValidate)) {
      throw new PackageValidationError(
        `Unsafe package path: ${path}`,
        "unsafe_path",
      );
    }
    if (paths.has(path)) {
      throw new PackageValidationError(
        `Duplicate package path: ${path}`,
        "duplicate_path",
      );
    }
    paths.add(path);
    const portablePath = path.normalize("NFC").toLocaleLowerCase("en-US");
    if (portablePaths.has(portablePath)) {
      throw new PackageValidationError(
        `Package paths collide on a case-insensitive filesystem: ${path}`,
        "duplicate_portable_path",
      );
    }
    portablePaths.add(portablePath);

    if ((flags & 0x1) !== 0) {
      throw new PackageValidationError(
        `Encrypted entry is not allowed: ${path}`,
        "encrypted_entry",
      );
    }
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      throw new PackageValidationError(
        `Unsupported compression method for ${path}.`,
        "unsupported_compression",
      );
    }
    if (isUnixSymlink(madeBy, externalAttributes)) {
      throw new PackageValidationError(
        `Symbolic links are not allowed: ${path}`,
        "symlink_not_allowed",
      );
    }

    expandedBytes += entryExpandedBytes;
    compressedEntryBytes += compressedBytes;
    if (expandedBytes > PACKAGE_LIMITS.expandedBytes) {
      throw new PackageValidationError(
        `Expanded package exceeds ${PACKAGE_LIMITS.expandedBytes} bytes.`,
        "expanded_package_too_large",
      );
    }

    entries.push({
      path,
      crc32,
      compressedBytes,
      expandedBytes: entryExpandedBytes,
      compressionMethod,
      directory,
    });
    cursor = nextCursor;
  }

  if (
    compressedEntryBytes > 0 &&
    expandedBytes / compressedEntryBytes > PACKAGE_LIMITS.maxCompressionRatio
  ) {
    throw new PackageValidationError(
      "Package compression ratio is suspiciously high.",
      "compression_ratio_too_high",
    );
  }

  const requiredPaths = [
    "command.json",
    "README.md",
    manifest.entrypoint.file,
    manifest.icon,
    ...manifest.dependencies.files,
  ];
  const filePaths = new Set(
    entries.filter((entry) => !entry.directory).map((entry) => entry.path),
  );
  for (const requiredPath of requiredPaths) {
    if (!filePaths.has(requiredPath)) {
      throw new PackageValidationError(
        `Package is missing required file: ${requiredPath}`,
        "missing_required_file",
      );
    }
  }

  const readme = verifyEmbeddedManifest(bytes, manifest, entries);

  return {
    entries,
    compressedBytes: bytes.byteLength,
    expandedBytes,
    readme,
  };
}

function verifyEmbeddedManifest(
  bytes: ArrayBuffer,
  expected: CommandManifest,
  entries: ZipEntry[],
) {
  let extracted: Record<string, Uint8Array>;
  try {
    // Central-directory limits are enforced first, so a full pass remains
    // bounded while also validating every local header and compressed stream.
    extracted = unzipSync(new Uint8Array(bytes));
  } catch {
    throw new PackageValidationError(
      "The embedded command.json could not be decompressed.",
      "invalid_embedded_manifest",
    );
  }
  for (const entry of entries) {
    if (entry.directory) continue;
    const actual = extracted[entry.path];
    if (!actual || actual.byteLength !== entry.expandedBytes) {
      throw new PackageValidationError(
        `Expanded size does not match the ZIP directory for ${entry.path}.`,
        "invalid_expanded_size",
      );
    }
    if (crc32(actual) !== entry.crc32) {
      throw new PackageValidationError(
        `CRC validation failed for ${entry.path}.`,
        "invalid_crc",
      );
    }
  }
  const file = extracted["command.json"];
  if (!file || file.byteLength > 256 * 1024) {
    throw new PackageValidationError(
      "The embedded command.json is missing or too large.",
      "invalid_embedded_manifest",
    );
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file));
  } catch {
    throw new PackageValidationError(
      "The embedded command.json must be valid UTF-8 JSON.",
      "invalid_embedded_manifest",
    );
  }

  const embedded = parseManifest(decoded);
  const canonicalExpected = parseManifest(expected);
  if (!embedded.success || !canonicalExpected.success) {
    throw new PackageValidationError(
      "The embedded command.json does not match the COMMANDS v1 schema.",
      "invalid_embedded_manifest",
    );
  }
  if (JSON.stringify(embedded.data) !== JSON.stringify(canonicalExpected.data)) {
    throw new PackageValidationError(
      "The uploaded manifest and the package's command.json must describe the same command.",
      "manifest_mismatch",
    );
  }

  const readmeFile = extracted["README.md"];
  if (!readmeFile || readmeFile.byteLength > 100_000) {
    throw new PackageValidationError(
      "README.md is missing or exceeds 100,000 bytes.",
      "invalid_readme",
    );
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(readmeFile).trim();
  } catch {
    throw new PackageValidationError(
      "README.md must be valid UTF-8 text.",
      "invalid_readme",
    );
  }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function packageObjectKey(
  commandId: string,
  version: string,
  checksum: string,
): string {
  return `packages/${commandId}/${version}/${checksum}.zip`;
}

export function packageDownloadName(slug: string, version: string): string {
  const safeSlug = slug.replace(/[^a-z0-9-]/gi, "-").toLocaleLowerCase();
  const safeVersion = version.replace(/[^0-9A-Za-z.+-]/g, "-");
  return `${safeSlug}-${safeVersion}.zip`;
}

export function manifestFromCommand(command: CommandRecord): CommandManifest {
  const fileDependencies = command.dependencies
    .filter((dependency) => dependency.startsWith("./"))
    .map((dependency) => `src/${dependency.slice(2)}`);
  const pythonDependencies = command.dependencies.filter(
    (dependency) => !dependency.startsWith("./"),
  );

  return {
    schemaVersion: "1.0",
    slug: command.slug,
    name: command.name,
    commandName: command.commandName ?? command.name,
    version: command.version,
    summary: command.summary,
    description: command.description,
    category: command.category,
    tags: command.tags,
    license: command.license ?? "LicenseRef-Pending",
    entrypoint: { file: "src/main.py", callable: "run_command" },
    icon: "icon.svg",
    runtime: {
      host: "rhino",
      rhinoVersions: command.rhinoVersions,
      pythonEngine: command.pythonEngine,
    },
    dependencies: {
      python: pythonDependencies,
      commands: [],
      rhinoPlugins: [],
      files: fileDependencies,
    },
    permissions: command.permissions as CommandManifest["permissions"],
    interface: {
      inputs: command.inputs.map((input) => ({
        ...input,
        required: input.required ?? false,
      })),
      outputs: command.outputs.map((output) => ({
        ...output,
        required: output.required ?? false,
      })),
    },
    agent: {
      callable: false,
      description: `${command.summary} Agent invocation is disabled until this imported draft is reviewed and packaged.`,
      sideEffects: command.permissions as CommandManifest["permissions"],
    },
    provenance: {
      status: "imported-draft",
      source: command.provenance,
      sourceFile: command.sourceFile,
      snapshotDate: "2026-10-15",
    },
  };
}

function findEndOfCentralDirectory(view: DataView): number {
  const minimumOffset = Math.max(0, view.byteLength - 65_557);
  for (let offset = view.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  throw new PackageValidationError(
    "File is not a supported ZIP archive.",
    "invalid_zip",
  );
}

function isUnixSymlink(madeBy: number, externalAttributes: number): boolean {
  const platform = madeBy >>> 8;
  if (platform !== 3) return false;
  const unixMode = externalAttributes >>> 16;
  return (unixMode & 0xf000) === 0xa000;
}
