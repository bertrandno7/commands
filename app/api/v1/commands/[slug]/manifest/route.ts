import { getSeedCommand } from "@/lib/commands";
import { manifestFromCommand } from "@/lib/command-package";
import { apiError, isMissingStorage, jsonResponse } from "@/app/api/v1/_lib/http";
import { findPublishedVersion } from "@/app/api/v1/_lib/repository";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  try {
    const stored = await findPublishedVersion(slug);
    if (stored) {
      return jsonResponse(JSON.parse(stored.version.manifestJson), {
        headers: {
          "cache-control": "public, max-age=60",
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
  if (!seed) return apiError(404, "command_not_found", "Command not found.");
  return jsonResponse(manifestFromCommand(seed), {
    headers: { "cache-control": "public, max-age=300" },
  });
}
