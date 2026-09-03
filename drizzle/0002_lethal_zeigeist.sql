CREATE TABLE `auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`device_label` text NOT NULL,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE INDEX `auth_sessions_role_active_idx` ON `auth_sessions` (`role`,`revoked_at`,`expires_at`);--> statement-breakpoint
CREATE TABLE `social_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label` text NOT NULL,
	`url` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `social_links_enabled_sort_idx` ON `social_links` (`enabled`,`sort_order`);--> statement-breakpoint
ALTER TABLE `events` ADD `details` text;--> statement-breakpoint
ALTER TABLE `visitor_groups` ADD `middle_grade1_count` integer;--> statement-breakpoint
ALTER TABLE `visitor_groups` ADD `middle_grade2_count` integer;--> statement-breakpoint
ALTER TABLE `visitor_groups` ADD `middle_grade3_count` integer;--> statement-breakpoint
ALTER TABLE `visitor_groups` ADD `high_grade1_count` integer;--> statement-breakpoint
ALTER TABLE `visitor_groups` ADD `high_grade2_count` integer;--> statement-breakpoint
ALTER TABLE `visitor_groups` ADD `high_grade3_count` integer;--> statement-breakpoint
UPDATE `visitor_groups`
SET `middle_grade1_count` = `grade1_count`,
    `middle_grade2_count` = `grade2_count`,
    `middle_grade3_count` = `grade3_count`
WHERE `middle_grade1_count` IS NULL
  AND (`grade1_count` IS NOT NULL OR `grade2_count` IS NOT NULL OR `grade3_count` IS NOT NULL);
