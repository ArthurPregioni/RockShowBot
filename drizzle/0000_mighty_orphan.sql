CREATE TABLE `watch_artists` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`normalized` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watch_artists_normalized_unique` ON `watch_artists` (`normalized`);--> statement-breakpoint
CREATE TABLE `show_events` (
	`id` text PRIMARY KEY NOT NULL,
	`artist` text NOT NULL,
	`title` text NOT NULL,
	`country` text NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`starts_at` text DEFAULT '' NOT NULL,
	`url` text NOT NULL,
	`source` text NOT NULL,
	`status` text DEFAULT 'unverified' NOT NULL,
	`notified` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `music_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`phase` text DEFAULT 'pending' NOT NULL,
	`expires` integer NOT NULL,
	`candidates` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scan_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`new_events` integer DEFAULT 0 NOT NULL,
	`warnings` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bot_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`notifications` integer DEFAULT 0 NOT NULL,
	`countries` text DEFAULT '["BR"]' NOT NULL,
	`schedule` text DEFAULT 'pending' NOT NULL
);
