CREATE TABLE `alert_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`recipient` text NOT NULL,
	`batch_key` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`snapshot` text NOT NULL,
	`message_id` text DEFAULT '' NOT NULL,
	`last_error` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`sent_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `alert_deliveries_batch_key_unique` ON `alert_deliveries` (`batch_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `one_active_alert_delivery` ON `alert_deliveries` (`recipient`) WHERE "alert_deliveries"."status" IN ('pending','claimed','unknown');--> statement-breakpoint
CREATE TABLE `alert_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`event_key` text NOT NULL,
	`revision` text NOT NULL,
	`recipient` text NOT NULL,
	`delivery_id` text DEFAULT '' NOT NULL,
	`message_id` text DEFAULT '' NOT NULL,
	`kind` text DEFAULT 'delivery' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE `show_events` ADD `identity_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `show_events` ADD `published_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `show_events` ADD `suppress_reason` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `events_identity_unique` ON `show_events` (`identity_key`) WHERE "show_events"."identity_key" <> '';