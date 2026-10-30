CREATE TABLE `preference_confirmations` (
	`id` text PRIMARY KEY NOT NULL,
	`dedupe_key` text NOT NULL,
	`email` text NOT NULL,
	`snapshot` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`message_id` text DEFAULT '' NOT NULL,
	`last_error` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`sent_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `preference_confirmations_dedupe_key_unique` ON `preference_confirmations` (`dedupe_key`);