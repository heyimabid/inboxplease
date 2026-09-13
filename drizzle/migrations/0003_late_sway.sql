CREATE TABLE `meta_onboarding_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`messenger_user_id` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `meta_page_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`onboarding_id` text NOT NULL,
	`facebook_page_id` text NOT NULL,
	`page_name` text NOT NULL,
	`encrypted_token` text NOT NULL,
	`token_key_version` text NOT NULL,
	`permissions_json` text NOT NULL,
	`tasks_json` text NOT NULL,
	FOREIGN KEY (`onboarding_id`) REFERENCES `meta_onboarding_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
DROP TABLE `oauth_states`;--> statement-breakpoint
ALTER TABLE `facebook_pages` ADD `ai_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `facebook_pages` ADD `permissions_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `facebook_pages` ADD `tasks_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `facebook_pages` ADD `messenger_user_id` text;--> statement-breakpoint
ALTER TABLE `facebook_pages` ADD `connection_id` text;--> statement-breakpoint
ALTER TABLE `sessions` DROP COLUMN `encrypted_user_token`;--> statement-breakpoint
ALTER TABLE `sessions` DROP COLUMN `token_key_version`;