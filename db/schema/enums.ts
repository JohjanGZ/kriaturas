import { pgEnum } from 'drizzle-orm/pg-core';
import { ELEMENTS } from '@/core/elements';
import { CONFIG_KEYS } from '@/core/schemas/config';
import { RESOURCE_KINDS, USER_ROLES } from '@/core/schemas/player';
import { OBJECTIVE_METRICS, OBJECTIVE_SCOPES } from '@/core/schemas/objectives';
import { EGG_STATUSES } from '@/core/schemas/eggs';
import { BATTLE_STATUSES } from '@/core/schemas/battle';

/**
 * Enum values are imported from /core so the database can never drift from the
 * domain. /core does not import from here — the dependency only points one way.
 */

/** Four base + N evolved. Base-only and evolved-only columns are narrowed with checks. */
export const elementEnum = pgEnum('element', ELEMENTS);

export const userRoleEnum = pgEnum('user_role', USER_ROLES);

export const configKeyEnum = pgEnum('config_key', CONFIG_KEYS);

export const resourceKindEnum = pgEnum('resource_kind', RESOURCE_KINDS);

export const objectiveMetricEnum = pgEnum('objective_metric', OBJECTIVE_METRICS);

export const objectiveScopeEnum = pgEnum('objective_scope', OBJECTIVE_SCOPES);

export const eggStatusEnum = pgEnum('egg_status', EGG_STATUSES);

export const battleStatusEnum = pgEnum('battle_status', BATTLE_STATUSES);
