import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { apiError, isSameOriginMutation, jsonResponse } from "@/app/api/v1/_lib/http";
import { ensureUser } from "@/app/api/v1/_lib/repository";
import { getDb } from "@/db";
import {
  commandDependencies,
  commandVersions,
  commands,
} from "@/db/schema";
import { getSeedCommand } from "@/lib/commands";
import {
  inspectCommandZip,
  packageObjectKey,
  PackageValidationError,
  PACKAGE_LIMITS,
  sha256Hex,
} from "@/lib/command-package";
import { parseManifestJson } from "@/lib/validation";

export const dynamic = "force-dynamic";

const OPEN_SOURCE_LICENSES = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "MPL-2.0",
  "GPL-3.0-only",
  "GPL-3.0-or-later",
  "LGPL-3.0-only",
  "LGPL-3.0-or-later",
  "AGPL-3.0-only",
  "AGPL-3.0-or-later",
  "CC0-1.0",
  "Unlicense",
]);

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return apiError(403, "invalid_origin", "Publish requests must be same-origin.");
  }

  const user = await getChatGPTUser();
  if (!user) {
    return apiError(401, "authentication_required", "Sign in to publish a command.");
  }
  if (!env.DB || !env.BUCKET) {
    return apiError(
      503,
      "storage_unavailable",
      "Publishing requires both D1 and R2 storage bindings.",
    );
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > PACKAGE_LIMITS.compressedBytes + 1024 * 1024) {
    return apiError(413, "request_too_large", "Upload exceeds the V1 package limit.");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError(400, "invalid_multipart", "Expected a multipart form upload.");
  }

  const packagePart = form.get("package");
  const manifestPart = form.get("manifest");
  const changelogPart = form.get("changelog");
  if (!(packagePart instanceof File)) {
    return apiError(400, "package_required", "Multipart field `package` must be a ZIP file.");
  }
  if (typeof manifestPart !== "string") {
    return apiError(400, "manifest_required", "Multipart field `manifest` must be a JSON string.");
  }
  if (!packagePart.name.toLocaleLowerCase().endsWith(".zip")) {
    return apiError(400, "invalid_package_type", "Package filename must end in .zip.");
  }
  if (
    packagePart.type &&
    !["application/zip", "application/x-zip-compressed", "application/octet-stream"].includes(
      packagePart.type,
    )
  ) {
    return apiError(400, "invalid_package_type", "Package content type must be ZIP.");
  }

  const parsedManifest = parseManifestJson(manifestPart);
  if (!parsedManifest.success) {
    return apiError(
      422,
      "invalid_manifest",
      "Manifest validation failed.",
      parsedManifest.errors,
    );
  }
  const manifest = parsedManifest.data;
  if (manifest.provenance?.status === "imported-draft") {
    return apiError(
      422,
      "invalid_provenance",
      "Community uploads cannot claim imported-draft provenance.",
    );
  }
  if (!manifest.license || !OPEN_SOURCE_LICENSES.has(manifest.license)) {
    return apiError(
      422,
      "open_license_required",
      "Community releases require a supported open-source SPDX license.",
      { supported: [...OPEN_SOURCE_LICENSES] },
    );
  }

  if (getSeedCommand(manifest.slug)) {
    return apiError(
      409,
      "reserved_seed_slug",
      "This slug belongs to an imported library draft. Fork it under a new slug before publishing.",
    );
  }

  let bytes: ArrayBuffer;
  let packageReadme: string;
  try {
    bytes = await packagePart.arrayBuffer();
    packageReadme = inspectCommandZip(bytes, manifest).readme;
  } catch (error) {
    if (error instanceof PackageValidationError) {
      return apiError(422, error.code, error.message);
    }
    throw error;
  }

  const checksum = await sha256Hex(bytes);
  const db = getDb();
  const profile = await ensureUser(user);
  const [existingCommand] = await db
    .select()
    .from(commands)
    .where(eq(commands.slug, manifest.slug))
    .limit(1);

  if (existingCommand && existingCommand.ownerId !== user.userId) {
    return apiError(409, "slug_taken", "Another creator already owns this slug.");
  }

  const commandId = existingCommand?.id ?? crypto.randomUUID();
  const [existingVersion] = await db
    .select({ id: commandVersions.id, checksum: commandVersions.checksumSha256 })
    .from(commandVersions)
    .where(
      and(
        eq(commandVersions.commandId, commandId),
        eq(commandVersions.version, manifest.version),
      ),
    )
    .limit(1);
  if (existingVersion) {
    return apiError(
      409,
      "version_exists",
      existingVersion.checksum === checksum
        ? "This immutable version is already published."
        : "That version already exists with different package content.",
    );
  }

  let currentLatestVersion: string | undefined;
  if (existingCommand?.latestVersionId) {
    const [latest] = await db
      .select({ version: commandVersions.version })
      .from(commandVersions)
      .where(eq(commandVersions.id, existingCommand.latestVersionId))
      .limit(1);
    currentLatestVersion = latest?.version;
  }
  const becomesLatest =
    !currentLatestVersion || compareSemver(manifest.version, currentLatestVersion) > 0;

  const versionId = crypto.randomUUID();
  const objectKey = packageObjectKey(commandId, manifest.version, checksum);
  const objectAlreadyExists = Boolean(await env.BUCKET.head(objectKey));
  if (!objectAlreadyExists) {
    await env.BUCKET.put(objectKey, bytes, {
      httpMetadata: { contentType: "application/zip" },
      customMetadata: {
        checksumSha256: checksum,
        commandId,
        version: manifest.version,
      },
    });
  }

  const readme = packageReadme;
  const changelog =
    typeof changelogPart === "string" ? changelogPart.trim().slice(0, 20_000) : "";
  const dependencyLabels = [
    ...manifest.dependencies.python,
    ...manifest.dependencies.commands.map(
      (dependency) => `${dependency.id}@${dependency.version}`,
    ),
    ...manifest.dependencies.rhinoPlugins,
    ...manifest.dependencies.files,
  ];
  const now = new Date().toISOString();

  const insertCommand = db.insert(commands).values({
        id: commandId,
        slug: manifest.slug,
        name: manifest.name,
        commandName: manifest.commandName,
        summary: manifest.summary,
        description: manifest.description,
        category: manifest.category,
        tagsJson: JSON.stringify(manifest.tags),
        status: "published",
        visibility: "public",
        ownerId: user.userId,
        authorName: profile.displayName,
        authorHandle: profile.handle,
        provenance: "community-publish",
        license: manifest.license,
        readme,
        keyFeaturesJson: "[]",
        rhinoVersionsJson: JSON.stringify(manifest.runtime.rhinoVersions),
        pythonEngine: manifest.runtime.pythonEngine,
        dependenciesJson: JSON.stringify(dependencyLabels),
        permissionsJson: JSON.stringify(manifest.permissions),
        inputsJson: JSON.stringify(manifest.interface.inputs),
        outputsJson: JSON.stringify(manifest.interface.outputs),
        publishedAt: now,
        updatedAt: now,
      });
  const insertVersion = db.insert(commandVersions).values({
      id: versionId,
      commandId,
      version: manifest.version,
      manifestJson: JSON.stringify(manifest),
      readme,
      releaseNotes: changelog,
      packageKey: objectKey,
      checksumSha256: checksum,
      sizeBytes: bytes.byteLength,
      createdBy: user.userId,
      createdAt: now,
    });

    const dependencyRows = [
      ...manifest.dependencies.python.map((name) => ({
        versionId,
        kind: "python",
        name,
        versionRange: "*",
      })),
      ...manifest.dependencies.commands.map((dependency) => ({
        versionId,
        kind: "command",
        name: dependency.id,
        versionRange: dependency.version,
      })),
      ...manifest.dependencies.rhinoPlugins.map((name) => ({
        versionId,
        kind: "rhino-plugin",
        name,
        versionRange: "*",
      })),
      ...manifest.dependencies.files.map((name) => ({
        versionId,
        kind: "bundled-file",
        name,
        versionRange: "*",
      })),
    ];
  const insertDependencies = dependencyRows.length
    ? db.insert(commandDependencies).values(dependencyRows)
    : null;
  const updateLatest = db
      .update(commands)
      .set({
        name: manifest.name,
        commandName: manifest.commandName,
        summary: manifest.summary,
        description: manifest.description,
        category: manifest.category,
        tagsJson: JSON.stringify(manifest.tags),
        status: "published",
        visibility: "public",
        authorName: profile.displayName,
        authorHandle: profile.handle,
        latestVersionId: versionId,
        license: manifest.license,
        readme,
        rhinoVersionsJson: JSON.stringify(manifest.runtime.rhinoVersions),
        pythonEngine: manifest.runtime.pythonEngine,
        dependenciesJson: JSON.stringify(dependencyLabels),
        permissionsJson: JSON.stringify(manifest.permissions),
        inputsJson: JSON.stringify(manifest.interface.inputs),
        outputsJson: JSON.stringify(manifest.interface.outputs),
        updatedAt: now,
        publishedAt: existingCommand?.publishedAt ?? now,
      })
      .where(eq(commands.id, commandId));

  try {
    if (!existingCommand) {
      if (insertDependencies) {
        await db.batch([insertCommand, insertVersion, insertDependencies, updateLatest]);
      } else {
        await db.batch([insertCommand, insertVersion, updateLatest]);
      }
    } else if (becomesLatest) {
      if (insertDependencies) {
        await db.batch([insertVersion, insertDependencies, updateLatest]);
      } else {
        await db.batch([insertVersion, updateLatest]);
      }
    } else if (insertDependencies) {
      await db.batch([insertVersion, insertDependencies]);
    } else {
      await insertVersion;
    }
  } catch (error) {
    // The package key is content-addressed and may be shared by a concurrent
    // successful request. Leave failed-upload objects for safe orphan cleanup.
    if (isUniqueConstraintError(error)) {
      return apiError(409, "publish_conflict", "The slug or version was published concurrently.");
    }
    throw error;
  }

  return jsonResponse({
    ok: true,
    slug: manifest.slug,
    version: manifest.version,
    url: `/commands/${encodeURIComponent(manifest.slug)}`,
    checksumSha256: checksum,
    latest: becomesLatest,
    warnings: parsedManifest.warnings,
  });
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed");
}

function compareSemver(left: string, right: string): number {
  const parse = (value: string) => {
    const [coreAndPre] = value.split("+");
    const [core, pre = ""] = coreAndPre.split("-");
    return {
      core: core.split(".").map(Number),
      pre: pre ? pre.split(".") : [],
    };
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a.core[index] ?? 0) - (b.core[index] ?? 0);
    if (difference) return Math.sign(difference);
  }
  if (!a.pre.length && !b.pre.length) return 0;
  if (!a.pre.length) return 1;
  if (!b.pre.length) return -1;
  const count = Math.max(a.pre.length, b.pre.length);
  for (let index = 0; index < count; index += 1) {
    const x = a.pre[index];
    const y = b.pre[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xNumber = /^\d+$/.test(x) ? Number(x) : null;
    const yNumber = /^\d+$/.test(y) ? Number(y) : null;
    if (xNumber !== null && yNumber !== null) return Math.sign(xNumber - yNumber);
    if (xNumber !== null) return -1;
    if (yNumber !== null) return 1;
    return x.localeCompare(y);
  }
  return 0;
}
