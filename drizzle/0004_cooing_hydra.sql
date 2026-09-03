ALTER TABLE `day_state` ADD `revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `events_day_undone_id_idx` ON `events` (`day_key`,`undone`,`id`);--> statement-breakpoint
CREATE INDEX `visitor_groups_day_status_admitted_idx` ON `visitor_groups` (`day_key`,`status`,`admitted_at`);--> statement-breakpoint
CREATE INDEX `visitor_groups_day_status_exited_idx` ON `visitor_groups` (`day_key`,`status`,`exited_at`);