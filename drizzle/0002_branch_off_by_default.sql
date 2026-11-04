PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`hlc` text NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`device_id` text NOT NULL,
	`name` text NOT NULL,
	`remote` text,
	`subdir` text DEFAULT '' NOT NULL,
	`checks` text,
	`update_on_branch` integer DEFAULT false NOT NULL,
	`major_pins` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_projects`("id", "hlc", "deleted", "device_id", "name", "remote", "subdir", "checks", "update_on_branch", "major_pins", "created_at") SELECT "id", "hlc", "deleted", "device_id", "name", "remote", "subdir", "checks", false, "major_pins", "created_at" FROM `projects`;--> statement-breakpoint
DROP TABLE `projects`;--> statement-breakpoint
ALTER TABLE `__new_projects` RENAME TO `projects`;--> statement-breakpoint
PRAGMA foreign_keys=ON;