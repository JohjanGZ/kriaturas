-- Una incubadora básica para todo jugador que ya existía.
--
-- Los jugadores creados antes de esta tabla se quedarían con un huevo comprado
-- y ningún sitio donde ponerlo: la incubadora se REGALA, no se compra, justo
-- para que eso no pueda pasar. Esto es ese regalo, aplicado hacia atrás.
--
-- Idempotente por el NOT EXISTS: volver a aplicarla no duplica nada.
INSERT INTO "incubators" ("player_id", "name", "capacity_days", "paid_amount")
SELECT p."id", 'Incubadora básica', 1, 0
FROM "players" p
WHERE NOT EXISTS (
  SELECT 1 FROM "incubators" i WHERE i."player_id" = p."id"
);
