import { relations } from 'drizzle-orm';
import { creatures } from './creatures';
import { eggCareLog, eggTypeSpecies, eggTypes, eggs } from './eggs';
import { evolutionPaths, evolutionRequirements } from './evolution';
import { gameConfigs, games } from './games';
import { objectiveProgress, objectives } from './objectives';
import { players } from './players';
import { species } from './species';
import { users } from './users';

export const usersRelations = relations(users, ({ one, many }) => ({
  player: one(players, { fields: [users.id], references: [players.userId] }),
  createdSpecies: many(species),
}));

export const playersRelations = relations(players, ({ one, many }) => ({
  user: one(users, { fields: [players.userId], references: [users.id] }),
  creatures: many(creatures),
  eggs: many(eggs),
  objectiveProgress: many(objectiveProgress),
}));

export const speciesRelations = relations(species, ({ one, many }) => ({
  createdByUser: one(users, { fields: [species.createdBy], references: [users.id] }),
  creatures: many(creatures),
  evolutionPaths: many(evolutionPaths),
  eggPools: many(eggTypeSpecies),
}));

export const evolutionPathsRelations = relations(evolutionPaths, ({ one, many }) => ({
  species: one(species, { fields: [evolutionPaths.speciesId], references: [species.id] }),
  requirements: many(evolutionRequirements),
  creatures: many(creatures),
}));

export const evolutionRequirementsRelations = relations(evolutionRequirements, ({ one }) => ({
  path: one(evolutionPaths, {
    fields: [evolutionRequirements.evolutionPathId],
    references: [evolutionPaths.id],
  }),
  objective: one(objectives, {
    fields: [evolutionRequirements.objectiveId],
    references: [objectives.id],
  }),
}));

export const objectivesRelations = relations(objectives, ({ many }) => ({
  progress: many(objectiveProgress),
  requiredBy: many(evolutionRequirements),
}));

export const objectiveProgressRelations = relations(objectiveProgress, ({ one }) => ({
  objective: one(objectives, {
    fields: [objectiveProgress.objectiveId],
    references: [objectives.id],
  }),
  player: one(players, { fields: [objectiveProgress.playerId], references: [players.id] }),
  creature: one(creatures, {
    fields: [objectiveProgress.creatureId],
    references: [creatures.id],
  }),
}));

export const creaturesRelations = relations(creatures, ({ one, many }) => ({
  player: one(players, { fields: [creatures.playerId], references: [players.id] }),
  species: one(species, { fields: [creatures.speciesId], references: [species.id] }),
  evolutionPath: one(evolutionPaths, {
    fields: [creatures.evolutionPathId],
    references: [evolutionPaths.id],
  }),
  objectiveProgress: many(objectiveProgress),
}));

export const eggTypesRelations = relations(eggTypes, ({ many }) => ({
  pool: many(eggTypeSpecies),
  eggs: many(eggs),
}));

export const eggTypeSpeciesRelations = relations(eggTypeSpecies, ({ one }) => ({
  eggType: one(eggTypes, { fields: [eggTypeSpecies.eggTypeId], references: [eggTypes.id] }),
  species: one(species, { fields: [eggTypeSpecies.speciesId], references: [species.id] }),
}));

export const eggsRelations = relations(eggs, ({ one, many }) => ({
  player: one(players, { fields: [eggs.playerId], references: [players.id] }),
  eggType: one(eggTypes, { fields: [eggs.eggTypeId], references: [eggTypes.id] }),
  species: one(species, { fields: [eggs.speciesId], references: [species.id] }),
  creature: one(creatures, { fields: [eggs.creatureId], references: [creatures.id] }),
  careLog: many(eggCareLog),
}));

export const eggCareLogRelations = relations(eggCareLog, ({ one }) => ({
  egg: one(eggs, { fields: [eggCareLog.eggId], references: [eggs.id] }),
}));

export const gamesRelations = relations(games, ({ many }) => ({
  configs: many(gameConfigs),
}));

export const gameConfigsRelations = relations(gameConfigs, ({ one }) => ({
  game: one(games, { fields: [gameConfigs.gameId], references: [games.id] }),
}));
