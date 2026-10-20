import { getSeedCommand } from "@/lib/commands";
import { apiError, isMissingStorage, jsonResponse } from "@/app/api/v1/_lib/http";
import { listPublishedVersions } from "@/app/api/v1/_lib/repository";
import { getSeedPackageMetadata } from "@/lib/seed-packages";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  try {
    const versions = await listPublishedVersions(slug);
    if (versions.length) {
      return jsonResponse({
        ok: true,
        data: versions.map((version) => ({
          ...version,
          manifest: `/api/v1/commands/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version.version)}/manifest`,
          download: `/api/v1/commands/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version.version)}/download`,
        })),
      });
    }
  } catch (error) {
    if (!isMissingStorage(error)) throw error;
  }

  const seed = getSeedCommand(slug);
  if (!seed) return apiError(404, "command_not_found", "Command not found.");
  const packageMetadata = getSeedPackageMetadata(seed.slug);
  return jsonResponse({
    ok: true,
    data: [
      {
        version: seed.version,
        checksumSha256: packageMetadata?.sha256 ?? null,
        sizeBytes: packageMetadata?.bytes ?? null,
        releaseNotes: "Imported draft from the GH Library snapshot.",
        createdAt: seed.updatedAt,
        status: "imported-draft",
        manifest: `/api/v1/commands/${encodeURIComponent(slug)}/versions/${encodeURIComponent(seed.version)}/manifest`,
        download: `/api/v1/commands/${encodeURIComponent(slug)}/versions/${encodeURIComponent(seed.version)}/download`,
      },
    ],
  });
}
