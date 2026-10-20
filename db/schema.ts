import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/** Platform identities are Site-scoped. Never use email as a durable key. */
export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    handle: text("handle").notNull(),
    bio: text("bio").notNull().default(""),
    sponsorUrl: text("sponsor_url"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("users_handle_unique").on(table.handle)],
);

export const commands = sqliteTable(
  "commands",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    commandName: text("command_name").notNull(),
    summary: text("summary").notNull(),
    description: text("description").notNull(),
    category: text("category").notNull(),
    tagsJson: text("tags_json").notNull().default("[]"),
    status: text("status").notNull().default("draft"),
    visibility: text("visibility").notNull().default("public"),
    ownerId: text("owner_id").references(() => users.id, {
      onDelete: "set null",
    }),
    authorName: text("author_name").notNull(),
    authorHandle: text("author_handle").notNull(),
    coverKey: text("cover_key"),
    latestVersionId: text("latest_version_id"),
    forkedFromId: text("forked_from_id"),
    provenance: text("provenance").notNull().default("community-publish"),
    license: text("license"),
    readme: text("readme").notNull().default(""),
    keyFeaturesJson: text("key_features_json").notNull().default("[]"),
    rhinoVersionsJson: text("rhino_versions_json").notNull().default("[]"),
    pythonEngine: text("python_engine").notNull().default("Rhino Python"),
    dependenciesJson: text("dependencies_json").notNull().default("[]"),
    permissionsJson: text("permissions_json").notNull().default("[]"),
    inputsJson: text("inputs_json").notNull().default("[]"),
    outputsJson: text("outputs_json").notNull().default("[]"),
    downloadCount: integer("download_count").notNull().default(0),
    starCount: integer("star_count").notNull().default(0),
    forkCount: integer("fork_count").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    publishedAt: text("published_at"),
  },
  (table) => [
    uniqueIndex("commands_slug_unique").on(table.slug),
    index("commands_category_idx").on(table.category),
    index("commands_visibility_status_idx").on(
      table.visibility,
      table.status,
    ),
    index("commands_owner_idx").on(table.ownerId),
    index("commands_updated_idx").on(table.updatedAt),
  ],
);

export const commandVersions = sqliteTable(
  "command_versions",
  {
    id: text("id").primaryKey(),
    commandId: text("command_id")
      .notNull()
      .references(() => commands.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    manifestJson: text("manifest_json").notNull(),
    readme: text("readme").notNull().default(""),
    releaseNotes: text("release_notes").notNull().default(""),
    packageKey: text("package_key").notNull(),
    checksumSha256: text("checksum_sha256").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    contentType: text("content_type").notNull().default("application/zip"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("command_versions_command_version_unique").on(
      table.commandId,
      table.version,
    ),
    index("command_versions_checksum_idx").on(table.checksumSha256),
    index("command_versions_command_idx").on(table.commandId),
  ],
);

export const commandAssets = sqliteTable(
  "command_assets",
  {
    id: text("id").primaryKey(),
    commandId: text("command_id")
      .notNull()
      .references(() => commands.id, { onDelete: "cascade" }),
    versionId: text("version_id").references(() => commandVersions.id, {
      onDelete: "cascade",
    }),
    kind: text("kind").notNull(),
    objectKey: text("object_key").notNull(),
    contentType: text("content_type").notNull(),
    altText: text("alt_text").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("command_assets_command_idx").on(table.commandId),
    index("command_assets_version_idx").on(table.versionId),
  ],
);

export const commandDependencies = sqliteTable(
  "command_dependencies",
  {
    versionId: text("version_id")
      .notNull()
      .references(() => commandVersions.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    versionRange: text("version_range").notNull().default("*"),
  },
  (table) => [
    primaryKey({ columns: [table.versionId, table.kind, table.name] }),
    index("command_dependencies_name_idx").on(table.kind, table.name),
  ],
);

export const stars = sqliteTable(
  "stars",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    commandId: text("command_id")
      .notNull()
      .references(() => commands.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [primaryKey({ columns: [table.userId, table.commandId] })],
);

/** Aggregate downloads by UTC day; do not retain visitor-identifying events. */
export const downloadCounters = sqliteTable(
  "download_counters",
  {
    versionId: text("version_id")
      .notNull()
      .references(() => commandVersions.id, { onDelete: "cascade" }),
    day: text("day").notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.versionId, table.day] })],
);

export const appState = sqliteTable("app_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
