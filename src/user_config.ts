import type { CardRule } from "./types.ts";
import { normalize } from "./util.ts";

export const USER_CONFIG_FORMAT = "klarwert-config";
export const USER_CONFIG_VERSION = 1;

export interface UserSettings {
  projection_active_days_per_week: number;
  derivative_underlyings?: Record<string, string>;
}

export interface UserConfig {
  format: typeof USER_CONFIG_FORMAT;
  version: typeof USER_CONFIG_VERSION;
  settings: UserSettings;
  card_rules: CardRule[];
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  projection_active_days_per_week: 3,
};

export function validateUserSettings(value: unknown): UserSettings {
  if (!value || typeof value !== "object") throw new Error("Missing settings object");
  const days = Number((value as Record<string, unknown>).projection_active_days_per_week);
  if (!Number.isInteger(days) || days < 1 || days > 7) {
    throw new Error("Active days per week must be an integer from 1 to 7");
  }
  const raw = (value as Record<string, unknown>).derivative_underlyings;
  const settings: UserSettings = { projection_active_days_per_week: days };
  if (raw !== undefined) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid derivative underlyings");
    const entries = Object.entries(raw);
    if (entries.length > 10000) throw new Error("Too many derivative underlyings");
    settings.derivative_underlyings = Object.fromEntries(entries.map(([isin, asset]) => {
      if (!/^[A-Z]{2}[A-Z0-9]{10}$/.test(isin) || typeof asset !== "string" || !asset.trim() || asset.length > 100) throw new Error("Invalid derivative underlying association");
      return [isin, asset.trim()];
    }));
  }
  return settings;
}

export function validateCardRules(value: unknown): CardRule[] {
  if (!Array.isArray(value)) throw new Error("Card rules must be an array");
  if (value.length > 1000) throw new Error("Configuration contains too many card rules");
  const byPattern = new Map<string, CardRule>();
  for (const item of value) {
    if (!item || typeof item !== "object") throw new Error("Invalid card rule");
    const pattern = String((item as Record<string, unknown>).pattern ?? "").trim();
    const category = String((item as Record<string, unknown>).category ?? "").trim();
    if (!pattern || !category) throw new Error("Every card rule needs a pattern and category");
    if (pattern.length > 200 || category.length > 100) throw new Error("Card rule is too long");
    byPattern.set(normalize(pattern), { pattern, category });
  }
  return [...byPattern.values()];
}

export function makeUserConfig(settings: UserSettings, cardRules: CardRule[]): UserConfig {
  return {
    format: USER_CONFIG_FORMAT,
    version: USER_CONFIG_VERSION,
    settings: validateUserSettings(settings),
    card_rules: validateCardRules(cardRules),
  };
}

export function parseUserConfig(value: unknown): UserConfig {
  if (!value || typeof value !== "object") throw new Error("Invalid configuration file");
  const input = value as Record<string, unknown>;
  if (input.format !== USER_CONFIG_FORMAT) throw new Error("This is not a Klarwert configuration file");
  if (input.version !== USER_CONFIG_VERSION) throw new Error(`Unsupported configuration version: ${String(input.version)}`);
  return makeUserConfig(validateUserSettings(input.settings), validateCardRules(input.card_rules));
}
