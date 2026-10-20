import { and, desc, eq, sql } from "drizzle-orm";
import type { ChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import {
  commandVersions,
  commands,
  downloadCounters,
  users,
} from "@/db/schema";
import {
  commandFromStoredRow,
  type CommandRecord,
} from "@/lib/commands";

export async function listPublishedCommands(): Promise<CommandRecord[]> {
  const db = getDb();
  const rows = await db
    .select({ command: commands, version: commandVersions.version })
    .from(commands)
    .leftJoin(commandVersions, eq(commands.latestVersionId, commandVersions.id))
    .where(
      and(eq(commands.visibility, "public"), eq(commands.status, "published")),
    )
    .orderBy(desc(commands.updatedAt))
    .limit(250);

  return rows.map(({ command, version }) =>
    commandFromStoredRow(command, version ?? "0.0.0"),
  );
}

export async function findPublishedCommand(slug: string) {
  const db = getDb();
  const [result] = await db
    .select({ command: commands, version: commandVersions })
    .from(commands)
    .leftJoin(commandVersions, eq(commands.latestVersionId, commandVersions.id))
    .where(
      and(
        eq(commands.slug, slug),
        eq(commands.visibility, "public"),
        eq(commands.status, "published"),
      ),
    )
    .limit(1);
  return result ?? null;
}

export async function findPublishedVersion(slug: string, version?: string) {
  const db = getDb();
  const conditions = [
    eq(commands.slug, slug),
    eq(commands.visibility, "public"),
    eq(commands.status, "published"),
  ];
  if (version) conditions.push(eq(commandVersions.version, version));
  else conditions.push(eq(commands.latestVersionId, commandVersions.id));

  const [result] = await db
    .select({ command: commands, version: commandVersions })
    .from(commands)
    .innerJoin(commandVersions, eq(commandVersions.commandId, commands.id))
    .where(and(...conditions))
    .limit(1);
  return result ?? null;
}

export async function listPublishedVersions(slug: string) {
  const db = getDb();
  return db
    .select({
      version: commandVersions.version,
      checksumSha256: commandVersions.checksumSha256,
      sizeBytes: commandVersions.sizeBytes,
      releaseNotes: commandVersions.releaseNotes,
      createdAt: commandVersions.createdAt,
    })
    .from(commandVersions)
    .innerJoin(commands, eq(commandVersions.commandId, commands.id))
    .where(
      and(
        eq(commands.slug, slug),
        eq(commands.visibility, "public"),
        eq(commands.status, "published"),
      ),
    )
    .orderBy(desc(commandVersions.createdAt));
}

export async function recordDownload(commandId: string, versionId: string) {
  const db = getDb();
  const day = new Date().toISOString().slice(0, 10);
  await db
    .insert(downloadCounters)
    .values({ versionId, day, count: 1 })
    .onConflictDoUpdate({
      target: [downloadCounters.versionId, downloadCounters.day],
      set: { count: sql`${downloadCounters.count} + 1` },
    });
  await db
    .update(commands)
    .set({ downloadCount: sql`${commands.downloadCount} + 1` })
    .where(eq(commands.id, commandId));
}

export async function ensureUser(user: ChatGPTUser) {
  const db = getDb();
  const handle = await defaultHandle(user);
  await db
    .insert(users)
    .values({
      id: user.userId,
      email: user.email,
      displayName: user.displayName,
      handle,
    })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        email: user.email,
        displayName: user.displayName,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      },
    });

  const [stored] = await db
    .select()
    .from(users)
    .where(eq(users.id, user.userId))
    .limit(1);
  if (!stored) throw new Error("Unable to create publisher profile.");
  return stored;
}

export async function ensureSeedShadow(command: CommandRecord) {
  const db = getDb();
  const id = `seed:${command.slug}`;
  await db
    .insert(commands)
    .values({
      id,
      slug: command.slug,
      name: command.name,
      commandName: command.commandName ?? command.name,
      summary: command.summary,
      description: command.description,
      category: command.category,
      tagsJson: JSON.stringify(command.tags),
      status: "imported-draft",
      visibility: "public",
      authorName: command.author.name,
      authorHandle: command.author.handle,
      provenance: command.provenance,
      license: command.license,
      readme: command.readme,
      keyFeaturesJson: JSON.stringify(command.keyFeatures),
      rhinoVersionsJson: JSON.stringify(command.rhinoVersions),
      pythonEngine: command.pythonEngine,
      dependenciesJson: JSON.stringify(command.dependencies),
      permissionsJson: JSON.stringify(command.permissions),
      inputsJson: JSON.stringify(command.inputs),
      outputsJson: JSON.stringify(command.outputs),
      updatedAt: command.updatedAt,
    })
    .onConflictDoNothing({ target: commands.slug });

  const [stored] = await db
    .select()
    .from(commands)
    .where(eq(commands.slug, command.slug))
    .limit(1);
  if (!stored) throw new Error("Unable to initialize imported draft state.");
  return stored;
}

export async function seedEngagement(): Promise<
  Map<string, { downloads: number; stars: number; forks: number }>
> {
  const db = getDb();
  const rows = await db
    .select({
      slug: commands.slug,
      downloads: commands.downloadCount,
      stars: commands.starCount,
      forks: commands.forkCount,
    })
    .from(commands)
    .where(eq(commands.status, "imported-draft"));
  return new Map(
    rows.map((row) => [
      row.slug,
      { downloads: row.downloads, stars: row.stars, forks: row.forks },
    ]),
  );
}

export async function recordSeedDownload(command: CommandRecord) {
  const stored = await ensureSeedShadow(command);
  const db = getDb();
  await db
    .update(commands)
    .set({ downloadCount: sql`${commands.downloadCount} + 1` })
    .where(eq(commands.id, stored.id));
}

async function defaultHandle(user: ChatGPTUser): Promise<string> {
  const base = (user.fullName || "creator")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32) || "creator";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(user.userId),
  );
  const suffix = Array.from(new Uint8Array(digest).slice(0, 4), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${base}-${suffix}`;
}
