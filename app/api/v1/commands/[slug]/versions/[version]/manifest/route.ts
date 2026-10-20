import { getSeedCommand } from "@/lib/commands";
import { manifestFromCommand } from "@/lib/command-package";
import { apiError, isMissingStorage, jsonResponse } from "@/app/api/v1/_lib/http";
import { findPublishedVersion } from "@/app/api/v1/_lib/repository";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string; version: string }> },
) {
  const { slug, version } = await context.params;
  try {
    const stored = await findPublishedVersion(slug, version);
    if (stored) {
      return jsonResponse(JSON.parse(stored.version.manifestJson), {
        headers: {
          "cache-control": "public, max-age=31536000, immutable",
          etag: `"sha256-${stored.version.checksumSha256}"`,
        },
      });
    }
  } catch (error) {
    if (!isMissingStorage(error)) {
      if (error instanceof SyntaxError) {
        return apiError(500, "invalid_stored_manifest", "Stored manifest is invalid.");
      }
      throw error;
    }
  }

  const seed = getSeedCommand(slug);
  if (!seed || seed.version !== version) {
    return apiError(404, "version_not_found", "Command version not found.");
  }
  return jsonResponse(manifestFromCommand(seed), {
    headers: { "cache-control": "public, max-age=300" },
  });
}
