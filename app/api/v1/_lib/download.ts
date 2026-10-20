import { env } from "cloudflare:workers";
import { getSeedCommand } from "@/lib/commands";
import { packageDownloadName } from "@/lib/command-package";
import { getSeedPackageMetadata } from "@/lib/seed-packages";
import { apiError, isMissingStorage } from "@/app/api/v1/_lib/http";
import {
  findPublishedVersion,
  recordDownload,
  recordSeedDownload,
} from "@/app/api/v1/_lib/repository";

export async function downloadCommandPackage(
  request: Request,
  slug: string,
  requestedVersion?: string,
) {
  try {
    const stored = await findPublishedVersion(slug, requestedVersion);
    if (stored) {
      if (!env.BUCKET) {
        return apiError(503, "storage_unavailable", "Package storage is unavailable.");
      }
      const object = await env.BUCKET.get(stored.version.packageKey);
      if (!object) {
        return apiError(503, "package_missing", "Published package object is missing.");
      }

      if (request.headers.get("if-none-match") === object.httpEtag) {
        return new Response(null, { status: 304, headers: { etag: object.httpEtag } });
      }

      try {
        await recordDownload(stored.command.id, stored.version.id);
      } catch {
        // A metrics failure must not make an otherwise valid package unavailable.
      }

      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("content-type", stored.version.contentType);
      headers.set("content-length", String(stored.version.sizeBytes));
      headers.set("etag", object.httpEtag);
      headers.set("cache-control", "public, max-age=31536000, immutable");
      headers.set(
        "content-disposition",
        `attachment; filename="${packageDownloadName(slug, stored.version.version)}"`,
      );
      headers.set("x-content-sha256", stored.version.checksumSha256);
      return new Response(object.body, { headers });
    }
  } catch (error) {
    if (!isMissingStorage(error)) throw error;
  }

  const seed = getSeedCommand(slug);
  if (!seed || (requestedVersion && requestedVersion !== seed.version)) {
    return apiError(404, "version_not_found", "Command version not found.");
  }
  if (seed.downloadAvailable === false) {
    return apiError(
      409,
      "package_migration_pending",
      "This imported command is cataloged, but its downloadable package has not been migrated yet.",
    );
  }

  try {
    await recordSeedDownload(seed);
  } catch {
    // Seed packages remain available when counters or D1 are unavailable.
  }

  const target = new URL(
    `/packages/${encodeURIComponent(seed.slug)}-${encodeURIComponent(seed.version)}.command.zip`,
    request.url,
  );
  const metadata = getSeedPackageMetadata(seed.slug);
  return new Response(null, {
    status: 307,
    headers: {
      location: target.toString(),
      "cache-control": "public, max-age=300",
      "x-commands-status": "imported-draft",
      "x-commands-license": "LicenseRef-Pending",
      ...(metadata
        ? {
            "x-content-sha256": metadata.sha256,
            "x-content-length": String(metadata.bytes),
          }
        : {}),
    },
  });
}
