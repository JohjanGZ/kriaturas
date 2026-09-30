-- Removing a config KEY is not like adding one: `playConfigSchema` is strict, so a
-- stored row that still carries the old key throws on read. Adding the default
-- covers a key that was added; stripping it covers a key that was removed.
UPDATE "game_configs" SET "value" = "value" - 'drakofrutaPerWin' WHERE "key" = 'play';
