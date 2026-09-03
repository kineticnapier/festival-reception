CREATE TABLE `day_state` (
	`day_key` text PRIMARY KEY NOT NULL,
	`current_count` integer DEFAULT 0 NOT NULL,
	`total_count` integer DEFAULT 0 NOT NULL,
	`max_current` integer DEFAULT 0 NOT NULL,
	`next_ticket` integer DEFAULT 1 NOT NULL,
	`called_ticket_number` integer,
	`capacity` integer DEFAULT 6 NOT NULL,
	`prior_stay_minutes` integer DEFAULT 8 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`day_key` text NOT NULL,
	`op_id` text NOT NULL,
	`type` text NOT NULL,
	`ticket_number` integer,
	`party_size` integer DEFAULT 1 NOT NULL,
	`undone` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_day_created_idx` ON `events` (`day_key`,`created_at`);--> statement-breakpoint
CREATE INDEX `events_day_op_idx` ON `events` (`day_key`,`op_id`);--> statement-breakpoint
CREATE TABLE `tickets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`day_key` text NOT NULL,
	`number` integer NOT NULL,
	`party_size` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`created_at` integer NOT NULL,
	`called_at` integer,
	`admitted_at` integer,
	`cancelled_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tickets_day_number_unique` ON `tickets` (`day_key`,`number`);--> statement-breakpoint
CREATE INDEX `tickets_day_status_number_idx` ON `tickets` (`day_key`,`status`,`number`);