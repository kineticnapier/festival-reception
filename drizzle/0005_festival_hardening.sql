CREATE TABLE `operation_requests` (
  `request_id` text PRIMARY KEY NOT NULL,
  `day_key` text NOT NULL,
  `action` text NOT NULL,
  `state` text NOT NULL DEFAULT 'started',
  `response_json` text,
  `error_message` text,
  `created_at` integer NOT NULL,
  `completed_at` integer
);
--> statement-breakpoint
CREATE INDEX `operation_requests_day_created_idx` ON `operation_requests` (`day_key`,`created_at`);
--> statement-breakpoint
CREATE TABLE `mutation_locks` (
  `day_key` text PRIMARY KEY NOT NULL,
  `owner_request_id` text NOT NULL,
  `acquired_at` integer NOT NULL,
  `expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mutation_locks_expires_idx` ON `mutation_locks` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `auth_rate_limits` (
  `scope_key` text PRIMARY KEY NOT NULL,
  `failure_count` integer NOT NULL DEFAULT 0,
  `window_started_at` integer NOT NULL,
  `blocked_until` integer NOT NULL DEFAULT 0,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_rate_limits_updated_idx` ON `auth_rate_limits` (`updated_at`);
