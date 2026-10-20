import { isMissingStorage } from "@/app/api/v1/_lib/http";
import {
  findPublishedCommand,
  listPublishedCommands,
  seedEngagement,
} from "@/app/api/v1/_lib/repository";
import {
  commandFromStoredRow,
  getSeedCommand,
  seedCommands,
  type CommandRecord,
} from "@/lib/commands";

/**
 * Server-side catalog view used by the product UI. Community releases in D1
 * replace same-slug seeds; the bundled catalog remains a resilient fallback.
 */
export async function getCatalogCommands(): Promise<CommandRecord[]> {
  let published: CommandRecord[] = [];
  let engagement = new Map<
    string,
    { downloads: number; stars: number; forks: number }
  >();

  try {
    [published, engagement] = await Promise.all([
      listPublishedCommands(),
      seedEngagement(),
    ]);
  } catch (error) {
    if (!isMissingStorage(error)) throw error;
  }

  const bySlug = new Map(
    seedCommands.map((command) => [
      command.slug,
      engagement.has(command.slug)
        ? { ...command, stats: engagement.get(command.slug)! }
        : command,
    ]),
  );
  for (const command of published) bySlug.set(command.slug, command);
  return [...bySlug.values()];
}

export async function getCatalogCommand(slug: string): Promise<CommandRecord | undefined> {
  try {
    const stored = await findPublishedCommand(slug);
    if (stored?.version) {
      return commandFromStoredRow(stored.command, stored.version.version);
    }
  } catch (error) {
    if (!isMissingStorage(error)) throw error;
  }

  let seed = getSeedCommand(slug);
  if (!seed) return undefined;
  try {
    const stats = (await seedEngagement()).get(slug);
    if (stats) seed = { ...seed, stats };
  } catch (error) {
    if (!isMissingStorage(error)) throw error;
  }
  return seed;
}
