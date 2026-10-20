import { commandFromStoredRow, getSeedCommand } from "@/lib/commands";
import { apiError, isMissingStorage, jsonResponse } from "@/app/api/v1/_lib/http";
import {
  findPublishedCommand,
  seedEngagement,
} from "@/app/api/v1/_lib/repository";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  try {
    const stored = await findPublishedCommand(slug);
    if (stored?.version) {
      return jsonResponse(
        {
          ok: true,
          data: commandFromStoredRow(stored.command, stored.version.version),
          links: commandLinks(slug, stored.version.version),
        },
        { headers: { "cache-control": "public, max-age=30" } },
      );
    }
  } catch (error) {
    if (!isMissingStorage(error)) throw error;
  }

  let seed = getSeedCommand(slug);
  if (!seed) return apiError(404, "command_not_found", "Command not found.");
  try {
    const engagement = (await seedEngagement()).get(slug);
    if (engagement) seed = { ...seed, stats: engagement };
  } catch (error) {
    if (!isMissingStorage(error)) throw error;
  }
  return jsonResponse(
    {
      ok: true,
      data: seed,
      links: commandLinks(slug, seed.version),
    },
    { headers: { "cache-control": "public, max-age=300" } },
  );
}

function commandLinks(slug: string, version: string) {
  const base = `/api/v1/commands/${encodeURIComponent(slug)}`;
  return {
    self: base,
    manifest: `${base}/versions/${encodeURIComponent(version)}/manifest`,
    download: `${base}/versions/${encodeURIComponent(version)}/download`,
  };
}
