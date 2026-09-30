import { z } from 'zod';

/**
 * Player-level resources. All three are a SHARED player pool, never per-creature,
 * and never interchangeable with each other — there is no conversion rate:
 *
 *   food        common. Restores stamina. Nothing else.
 *   coins       currency. Buys eggs and shop items. Never affects stamina or evolution.
 */

export const RESOURCE_KINDS = ['food', 'coins'] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];
export const resourceKindSchema = z.enum(RESOURCE_KINDS);

export const grantResourceSchema = z.strictObject({
  playerId: z.uuid(),
  resource: resourceKindSchema,
  amount: z.number().int().min(1).max(10_000),
});

export const playerIdSchema = z.strictObject({ playerId: z.uuid() });

export const USER_ROLES = ['player', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];
export const userRoleSchema = z.enum(USER_ROLES);

export type GrantResourceInput = z.infer<typeof grantResourceSchema>;
