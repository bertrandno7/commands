import { and, eq, sql } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { apiError, isSameOriginMutation, jsonResponse } from "@/app/api/v1/_lib/http";
import { ensureSeedShadow, ensureUser } from "@/app/api/v1/_lib/repository";
import { getDb } from "@/db";
import { commands, stars } from "@/db/schema";
import { getSeedCommand } from "@/lib/commands";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  if (!isSameOriginMutation(request)) {
    return apiError(403, "invalid_origin", "Star requests must be same-origin.");
  }
  const user = await getChatGPTUser();
  if (!user) return apiError(401, "authentication_required", "Sign in to star commands.");

  const { slug } = await context.params;
  const db = getDb();
  await ensureUser(user);
  const seed = getSeedCommand(slug);
  const command = seed
    ? await ensureSeedShadow(seed)
    : (
        await db
          .select()
          .from(commands)
          .where(
            and(
              eq(commands.slug, slug),
              eq(commands.visibility, "public"),
              eq(commands.status, "published"),
            ),
          )
          .limit(1)
      )[0];
  if (!command) return apiError(404, "command_not_found", "Command not found.");

  const [existing] = await db
    .select({ userId: stars.userId })
    .from(stars)
    .where(and(eq(stars.userId, user.userId), eq(stars.commandId, command.id)))
    .limit(1);

  let starred: boolean;
  if (existing) {
    await db
      .delete(stars)
      .where(and(eq(stars.userId, user.userId), eq(stars.commandId, command.id)));
    await db
      .update(commands)
      .set({ starCount: sql`max(${commands.starCount} - 1, 0)` })
      .where(eq(commands.id, command.id));
    starred = false;
  } else {
    await db.insert(stars).values({ userId: user.userId, commandId: command.id });
    await db
      .update(commands)
      .set({ starCount: sql`${commands.starCount} + 1` })
      .where(eq(commands.id, command.id));
    starred = true;
  }

  const [updated] = await db
    .select({ stars: commands.starCount })
    .from(commands)
    .where(eq(commands.id, command.id))
    .limit(1);
  return jsonResponse({ ok: true, starred, stars: updated?.stars ?? 0 });
}
