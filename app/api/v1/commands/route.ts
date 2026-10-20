import { seedCommands, filterCommands, type CommandRecord } from "@/lib/commands";
import { catalogQuerySchema } from "@/lib/validation";
import { apiError, isMissingStorage, jsonResponse } from "@/app/api/v1/_lib/http";
import {
  listPublishedCommands,
  seedEngagement,
} from "@/app/api/v1/_lib/repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = catalogQuerySchema.safeParse({
    q: url.searchParams.get("q") || undefined,
    category: url.searchParams.get("category") || undefined,
    sort: url.searchParams.get("sort") || undefined,
    cursor: url.searchParams.get("cursor") || undefined,
    limit: url.searchParams.get("limit") || undefined,
  });
  if (!query.success) {
    return apiError(400, "invalid_query", "Invalid catalog query.", query.error.flatten());
  }

  let stored: CommandRecord[] = [];
  let seedStats = new Map<
    string,
    { downloads: number; stars: number; forks: number }
  >();
  let storage: "d1" | "seed-only" = "d1";
  try {
    [stored, seedStats] = await Promise.all([
      listPublishedCommands(),
      seedEngagement(),
    ]);
  } catch (error) {
    if (!isMissingStorage(error)) throw error;
    storage = "seed-only";
  }

  const bySlug = new Map(
    seedCommands.map((command) => [
      command.slug,
      seedStats.has(command.slug)
        ? { ...command, stats: seedStats.get(command.slug)! }
        : command,
    ]),
  );
  for (const command of stored) bySlug.set(command.slug, command);
  const filtered = filterCommands([...bySlug.values()], {
    query: query.data.q,
    category: query.data.category,
    sort: query.data.sort,
  });
  const start = query.data.cursor;
  const end = Math.min(start + query.data.limit, filtered.length);
  const nextCursor = end < filtered.length ? end : null;

  return jsonResponse(
    {
      ok: true,
      data: filtered.slice(start, end),
      meta: {
        count: filtered.length,
        cursor: start,
        nextCursor,
        storage,
      },
    },
    { headers: { "cache-control": "public, max-age=30, stale-while-revalidate=120" } },
  );
}
