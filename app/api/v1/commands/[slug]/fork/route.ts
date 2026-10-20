import { and, eq, sql } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { apiError, isSameOriginMutation, jsonResponse } from "@/app/api/v1/_lib/http";
import { ensureSeedShadow, ensureUser } from "@/app/api/v1/_lib/repository";
import { getDb } from "@/db";
import { commands } from "@/db/schema";
import { getSeedCommand } from "@/lib/commands";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  if (!isSameOriginMutation(request)) {
    return apiError(403, "invalid_origin", "Fork requests must be same-origin.");
  }
  const user = await getChatGPTUser();
  if (!user) return apiError(401, "authentication_required", "Sign in to fork commands.");

  const { slug } = await context.params;
  const body = await optionalJson(request);
  if (body === null) return apiError(400, "invalid_json", "Fork options must be valid JSON.");

  const db = getDb();
  const profile = await ensureUser(user);
  const seed = getSeedCommand(slug);
  const source = seed
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
  if (!source) return apiError(404, "command_not_found", "Command not found.");

  const requestedSlug = typeof body.slug === "string" ? body.slug : undefined;
  if (requestedSlug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(requestedSlug)) {
    return apiError(422, "invalid_slug", "Fork slug must be lower-case kebab-case.");
  }
  const baseSlug = (
    requestedSlug ?? `${source.slug}-${profile.handle}`
  ).slice(0, 72).replace(/-+$/g, "");
  let forkSlug = baseSlug;
  const [collision] = await db
    .select({ id: commands.id })
    .from(commands)
    .where(eq(commands.slug, forkSlug))
    .limit(1);
  if (collision || getSeedCommand(forkSlug)) {
    forkSlug = `${baseSlug.slice(0, 67)}-${crypto.randomUUID().slice(0, 4)}`;
  }

  const name =
    typeof body.name === "string" && body.name.trim()
      ? body.name.trim().slice(0, 80)
      : `${source.name} Remix`;
  const commandName = `${source.commandName.replace(/[^A-Za-z0-9_]/g, "")}Remix`.slice(
    0,
    64,
  );
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.insert(commands).values({
    id,
    slug: forkSlug,
    name,
    commandName,
    summary: source.summary,
    description: source.description,
    category: source.category,
    tagsJson: source.tagsJson,
    status: "draft",
    visibility: "unlisted",
    ownerId: user.userId,
    authorName: profile.displayName,
    authorHandle: profile.handle,
    forkedFromId: source.id,
    provenance: `fork:${source.slug}`,
    license: source.license,
    readme: source.readme,
    keyFeaturesJson: source.keyFeaturesJson,
    rhinoVersionsJson: source.rhinoVersionsJson,
    pythonEngine: source.pythonEngine,
    dependenciesJson: source.dependenciesJson,
    permissionsJson: source.permissionsJson,
    inputsJson: source.inputsJson,
    outputsJson: source.outputsJson,
    createdAt: now,
    updatedAt: now,
  });
  await db
    .update(commands)
    .set({ forkCount: sql`${commands.forkCount} + 1` })
    .where(eq(commands.id, source.id));

  return jsonResponse(
    {
      ok: true,
      slug: forkSlug,
      status: "draft",
      url: `/publish?draft=${encodeURIComponent(forkSlug)}`,
      forkedFrom: source.slug,
    },
    { status: 201 },
  );
}

async function optionalJson(request: Request): Promise<Record<string, unknown> | null> {
  if (!request.headers.get("content-type")?.includes("application/json")) return {};
  try {
    const parsed: unknown = await request.json();
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
