CREATE INDEX `idx_refresh_tokens_hash` ON `refresh_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_refresh_tokens_expires` ON `refresh_tokens` (`expires_at`);