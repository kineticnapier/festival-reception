CREATE TABLE `visitor_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`day_key` text NOT NULL,
	`ticket_number` integer,
	`status` text DEFAULT 'waiting' NOT NULL,
	`party_size` integer NOT NULL,
	`student_count` integer,
	`external_count` integer,
	`grade1_count` integer,
	`grade2_count` integer,
	`grade3_count` integer,
	`male_count` integer,
	`female_count` integer,
	`adult_count` integer,
	`child_count` integer,
	`created_at` integer NOT NULL,
	`called_at` integer,
	`admitted_at` integer,
	`exited_at` integer,
	`cancelled_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `visitor_groups_day_ticket_unique` ON `visitor_groups` (`day_key`,`ticket_number`);--> statement-breakpoint
CREATE INDEX `visitor_groups_day_status_ticket_idx` ON `visitor_groups` (`day_key`,`status`,`ticket_number`);--> statement-breakpoint
ALTER TABLE `day_state` ADD `normal_capacity` integer DEFAULT 13 NOT NULL;--> statement-breakpoint
ALTER TABLE `day_state` ADD `overflow_capacity` integer DEFAULT 16 NOT NULL;--> statement-breakpoint
ALTER TABLE `day_state` ADD `overflow_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `day_state` ADD `prior_stay_seconds` integer DEFAULT 150 NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `group_id` integer;