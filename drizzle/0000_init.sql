CREATE TABLE `deploy_links` (
	`id` text PRIMARY KEY NOT NULL,
	`hlc` text NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`device_id` text NOT NULL,
	`project_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dismissals` (
	`id` text PRIMARY KEY NOT NULL,
	`hlc` text NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`device_id` text NOT NULL,
	`target` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `http_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`etag` text,
	`body` text NOT NULL,
	`stored_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `kv` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`key` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`route` text,
	`created_at` text NOT NULL,
	`read` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `project_paths` (
	`project_id` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`hlc` text NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`device_id` text NOT NULL,
	`name` text NOT NULL,
	`remote` text,
	`subdir` text DEFAULT '' NOT NULL,
	`checks` text,
	`update_on_branch` integer DEFAULT true NOT NULL,
	`push_after_commit` integer DEFAULT false NOT NULL,
	`open_pull_request` integer DEFAULT false NOT NULL,
	`major_pins` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`ok` integer,
	`result` text,
	`log` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` text PRIMARY KEY NOT NULL,
	`hlc` text NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`device_id` text NOT NULL,
	`value` text
);
--> statement-breakpoint
CREATE TABLE `snapshots` (
	`key` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `watched_repos` (
	`id` text PRIMARY KEY NOT NULL,
	`hlc` text NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`device_id` text NOT NULL,
	`owner` text NOT NULL,
	`repo` text NOT NULL
);
