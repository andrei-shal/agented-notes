CREATE INDEX `idx_calendar_events_dates` ON `calendar_events` (`start_date`,`end_date`);--> statement-breakpoint
CREATE INDEX `idx_kanban_tasks_column` ON `kanban_tasks` (`column_id`,`position`);--> statement-breakpoint
CREATE INDEX `idx_notes_created_at` ON `notes` (`created_at`);