CREATE TABLE `app_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `command_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`command_id` text NOT NULL,
	`version_id` text,
	`kind` text NOT NULL,
	`object_key` text NOT NULL,
	`content_type` text NOT NULL,
	`alt_text` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`command_id`) REFERENCES `commands`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`version_id`) REFERENCES `command_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `command_assets_command_idx` ON `command_assets` (`command_id`);--> statement-breakpoint
CREATE INDEX `command_assets_version_idx` ON `command_assets` (`version_id`);--> statement-breakpoint
CREATE TABLE `command_dependencies` (
	`version_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`version_range` text DEFAULT '*' NOT NULL,
	PRIMARY KEY(`version_id`, `kind`, `name`),
	FOREIGN KEY (`version_id`) REFERENCES `command_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `command_dependencies_name_idx` ON `command_dependencies` (`kind`,`name`);--> statement-breakpoint
CREATE TABLE `command_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`command_id` text NOT NULL,
	`version` text NOT NULL,
	`manifest_json` text NOT NULL,
	`readme` text DEFAULT '' NOT NULL,
	`release_notes` text DEFAULT '' NOT NULL,
	`package_key` text NOT NULL,
	`checksum_sha256` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`content_type` text DEFAULT 'application/zip' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`command_id`) REFERENCES `commands`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `command_versions_command_version_unique` ON `command_versions` (`command_id`,`version`);--> statement-breakpoint
CREATE INDEX `command_versions_checksum_idx` ON `command_versions` (`checksum_sha256`);--> statement-breakpoint
CREATE INDEX `command_versions_command_idx` ON `command_versions` (`command_id`);--> statement-breakpoint
CREATE TABLE `commands` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`command_name` text NOT NULL,
	`summary` text NOT NULL,
	`description` text NOT NULL,
	`category` text NOT NULL,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`visibility` text DEFAULT 'public' NOT NULL,
	`owner_id` text,
	`author_name` text NOT NULL,
	`author_handle` text NOT NULL,
	`cover_key` text,
	`latest_version_id` text,
	`forked_from_id` text,
	`provenance` text DEFAULT 'community-publish' NOT NULL,
	`license` text,
	`readme` text DEFAULT '' NOT NULL,
	`key_features_json` text DEFAULT '[]' NOT NULL,
	`rhino_versions_json` text DEFAULT '[]' NOT NULL,
	`python_engine` text DEFAULT 'Rhino Python' NOT NULL,
	`dependencies_json` text DEFAULT '[]' NOT NULL,
	`permissions_json` text DEFAULT '[]' NOT NULL,
	`inputs_json` text DEFAULT '[]' NOT NULL,
	`outputs_json` text DEFAULT '[]' NOT NULL,
	`download_count` integer DEFAULT 0 NOT NULL,
	`star_count` integer DEFAULT 0 NOT NULL,
	`fork_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`published_at` text,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `commands_slug_unique` ON `commands` (`slug`);--> statement-breakpoint
CREATE INDEX `commands_category_idx` ON `commands` (`category`);--> statement-breakpoint
CREATE INDEX `commands_visibility_status_idx` ON `commands` (`visibility`,`status`);--> statement-breakpoint
CREATE INDEX `commands_owner_idx` ON `commands` (`owner_id`);--> statement-breakpoint
CREATE INDEX `commands_updated_idx` ON `commands` (`updated_at`);--> statement-breakpoint
CREATE TABLE `download_counters` (
	`version_id` text NOT NULL,
	`day` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`version_id`, `day`),
	FOREIGN KEY (`version_id`) REFERENCES `command_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `stars` (
	`user_id` text NOT NULL,
	`command_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`user_id`, `command_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`command_id`) REFERENCES `commands`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`handle` text NOT NULL,
	`bio` text DEFAULT '' NOT NULL,
	`sponsor_url` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_handle_unique` ON `users` (`handle`);