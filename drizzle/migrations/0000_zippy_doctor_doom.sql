CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`actor_id` text,
	`action` text NOT NULL,
	`resource_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `audit_time` ON `audit_events` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `catalog_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`product_id` text NOT NULL,
	`revision` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error_category` text,
	`queued_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`product_id`) REFERENCES `products`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_revision` ON `catalog_jobs` (`workspace_id`,`product_id`,`revision`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`facebook_page_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`mode` text DEFAULT 'ai' NOT NULL,
	`order_state` text DEFAULT 'BROWSING' NOT NULL,
	`last_message_at` integer NOT NULL,
	`last_customer_message_at` integer NOT NULL,
	`last_ai_message_at` integer,
	`unread_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`customer_id`) REFERENCES `customers`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`facebook_page_id`) REFERENCES `facebook_pages`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_customer` ON `conversations` (`workspace_id`,`facebook_page_id`,`customer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `conversations_tenant_id` ON `conversations` (`workspace_id`,`id`);--> statement-breakpoint
CREATE INDEX `conversation_inbox` ON `conversations` (`workspace_id`,`last_message_at`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`facebook_page_id` text NOT NULL,
	`platform_customer_id` text NOT NULL,
	`name` text,
	`phone` text,
	`default_address` text,
	`language_preference` text,
	`language_evidence` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`facebook_page_id`) REFERENCES `facebook_pages`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_platform` ON `customers` (`workspace_id`,`facebook_page_id`,`platform_customer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `customers_tenant_id` ON `customers` (`workspace_id`,`id`);--> statement-breakpoint
CREATE TABLE `deletion_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `delivery_zones` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`fee` integer NOT NULL,
	`currency` text NOT NULL,
	`estimated_days` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "valid_delivery_fee" CHECK("delivery_zones"."fee" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `delivery_names` ON `delivery_zones` (`workspace_id`,`name`);--> statement-breakpoint
CREATE TABLE `order_draft_items` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`order_draft_id` text NOT NULL,
	`product_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_price_snapshot` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`order_draft_id`) REFERENCES `order_drafts`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`product_id`) REFERENCES `products`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`variant_id`) REFERENCES `product_variants`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "positive_draft_quantity" CHECK("order_draft_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `draft_variant` ON `order_draft_items` (`workspace_id`,`order_draft_id`,`variant_id`);--> statement-breakpoint
CREATE TABLE `product_faqs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`product_id` text,
	`question` text NOT NULL,
	`answer` text NOT NULL,
	`language` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`product_id`) REFERENCES `products`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `handoff_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`reason` text NOT NULL,
	`summary` text,
	`status` text NOT NULL,
	`assigned_user_id` text,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assigned_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`workspace_id`,`conversation_id`) REFERENCES `conversations`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `product_images` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`product_id` text NOT NULL,
	`variant_id` text,
	`r2_key` text NOT NULL,
	`public_url_or_delivery_key` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`alt_text` text,
	`sha256` text NOT NULL,
	`perceptual_hash` text,
	`vision_description` text,
	`vision_attributes_json` text,
	`vector_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`product_id`) REFERENCES `products`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`variant_id`) REFERENCES `product_variants`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_images_r2_key_unique` ON `product_images` (`r2_key`);--> statement-breakpoint
CREATE INDEX `images_hash` ON `product_images` (`workspace_id`,`sha256`);--> statement-breakpoint
CREATE TABLE `local_vectors` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`product_id` text NOT NULL,
	`document` text NOT NULL,
	`values_json` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`product_id`) REFERENCES `products`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workspace_members` (
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `user_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "valid_member_role" CHECK("workspace_members"."role" IN ('owner','admin','agent'))
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`meta_message_id` text,
	`direction` text NOT NULL,
	`sender_type` text NOT NULL,
	`message_type` text NOT NULL,
	`text` text,
	`attachment_json` text,
	`language` text,
	`ai_metadata_json` text,
	`delivery_status` text DEFAULT 'received' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`conversation_id`) REFERENCES `conversations`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_meta_message_id_unique` ON `messages` (`meta_message_id`);--> statement-breakpoint
CREATE INDEX `message_history` ON `messages` (`workspace_id`,`conversation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`return_session_id` text
);
--> statement-breakpoint
CREATE TABLE `order_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`state` text NOT NULL,
	`customer_name` text,
	`phone` text,
	`delivery_address` text,
	`delivery_area` text,
	`notes` text,
	`currency` text NOT NULL,
	`subtotal` integer,
	`delivery_fee` integer,
	`total` integer,
	`revision` integer DEFAULT 1 NOT NULL,
	`review_hash` text,
	`last_updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`conversation_id`) REFERENCES `conversations`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`customer_id`) REFERENCES `customers`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `draft_tenant_id` ON `order_drafts` (`workspace_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `one_draft` ON `order_drafts` (`workspace_id`,`conversation_id`);--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`order_id` text NOT NULL,
	`product_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`product_name_snapshot` text NOT NULL,
	`variant_name_snapshot` text NOT NULL,
	`sku_snapshot` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_price` integer NOT NULL,
	`line_total` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`order_id`) REFERENCES `orders`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`product_id`) REFERENCES `products`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`variant_id`) REFERENCES `product_variants`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "valid_line" CHECK("order_items"."quantity" > 0 AND "order_items"."unit_price" >= 0 AND "order_items"."line_total" = "order_items"."quantity" * "order_items"."unit_price")
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`order_number` text NOT NULL,
	`status` text NOT NULL,
	`customer_name` text NOT NULL,
	`phone` text NOT NULL,
	`delivery_address` text NOT NULL,
	`delivery_area` text NOT NULL,
	`currency` text NOT NULL,
	`subtotal` integer NOT NULL,
	`delivery_fee` integer NOT NULL,
	`total` integer NOT NULL,
	`notes` text,
	`idempotency_key` text NOT NULL,
	`confirmed_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`conversation_id`) REFERENCES `conversations`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`customer_id`) REFERENCES `customers`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "valid_order_total" CHECK("orders"."total" = "orders"."subtotal" + "orders"."delivery_fee" AND "orders"."subtotal" >= 0 AND "orders"."delivery_fee" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_order_number_unique` ON `orders` (`order_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_idempotency_key_unique` ON `orders` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_tenant_id` ON `orders` (`workspace_id`,`id`);--> statement-breakpoint
CREATE TABLE `facebook_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`facebook_page_id` text NOT NULL,
	`page_name` text NOT NULL,
	`page_picture_url` text,
	`encrypted_page_access_token` text,
	`token_key_version` text NOT NULL,
	`status` text NOT NULL,
	`webhook_subscribed_at` integer,
	`connected_by_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connected_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `facebook_pages_facebook_page_id_unique` ON `facebook_pages` (`facebook_page_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `pages_tenant_id` ON `facebook_pages` (`workspace_id`,`id`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`slug` text NOT NULL,
	`sku` text,
	`category` text,
	`description` text DEFAULT '' NOT NULL,
	`aliases` text DEFAULT '' NOT NULL,
	`base_price` integer NOT NULL,
	`compare_at_price` integer,
	`currency` text NOT NULL,
	`status` text NOT NULL,
	`is_ai_searchable` integer DEFAULT true NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`index_status` text DEFAULT 'pending' NOT NULL,
	`vector_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "valid_price" CHECK("products"."base_price" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_tenant_id` ON `products` (`workspace_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `products_slug` ON `products` (`workspace_id`,`slug`);--> statement-breakpoint
CREATE INDEX `products_lookup` ON `products` (`workspace_id`,`normalized_name`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text,
	`encrypted_user_token` text,
	`token_key_version` text,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `workspace_settings` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`auto_reply` integer DEFAULT false NOT NULL,
	`tone` text DEFAULT 'friendly' NOT NULL,
	`response_style` text DEFAULT 'match_customer' NOT NULL,
	`handoff_rules` text DEFAULT 'Refund disputes, threats, payment exceptions' NOT NULL,
	`retention_days` integer DEFAULT 30 NOT NULL,
	`temporary_image_hours` integer DEFAULT 24 NOT NULL,
	`normalization_json` text DEFAULT '{}' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `temporary_images` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`customer_id`) REFERENCES `customers`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `temporary_images_r2_key_unique` ON `temporary_images` (`r2_key`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`facebook_user_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`avatar_url` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_facebook_user_id_unique` ON `users` (`facebook_user_id`);--> statement-breakpoint
CREATE TABLE `product_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`product_id` text NOT NULL,
	`sku` text NOT NULL,
	`title` text NOT NULL,
	`color` text,
	`size` text,
	`attributes_json` text DEFAULT '{}' NOT NULL,
	`price_override` integer,
	`stock_on_hand` integer DEFAULT 0 NOT NULL,
	`reserved_stock` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`product_id`) REFERENCES `products`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "valid_inventory" CHECK("product_variants"."stock_on_hand" >= 0 AND "product_variants"."reserved_stock" >= 0 AND "product_variants"."reserved_stock" <= "product_variants"."stock_on_hand"),
	CONSTRAINT "valid_override" CHECK("product_variants"."price_override" IS NULL OR "product_variants"."price_override" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `variants_sku` ON `product_variants` (`workspace_id`,`sku`);--> statement-breakpoint
CREATE UNIQUE INDEX `variants_tenant_id` ON `product_variants` (`workspace_id`,`id`);--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`meta_event_id` text NOT NULL,
	`event_type` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'received' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`received_at` integer NOT NULL,
	`processed_at` integer,
	`queued_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_events_meta_event_id_unique` ON `webhook_events` (`meta_event_id`);--> statement-breakpoint
CREATE INDEX `webhook_pending` ON `webhook_events` (`status`,`queued_at`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`timezone` text DEFAULT 'Asia/Dhaka' NOT NULL,
	`default_language` text DEFAULT 'auto' NOT NULL,
	`currency` text DEFAULT 'BDT' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_slug_unique` ON `workspaces` (`slug`);