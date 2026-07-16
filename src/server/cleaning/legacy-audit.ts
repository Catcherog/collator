import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type LegacyModuleProfile,
  validateLegacyModuleProfiles,
} from './contracts/legacy-module-profile.js';

export type { LegacyModuleProfile };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPORT_PATH = path.resolve(__dirname, '..', '..', '..', 'reports', 'phase2', 'legacy-module-profiles.json');

function loadProfiles(): LegacyModuleProfile[] {
  const raw = fs.readFileSync(REPORT_PATH, 'utf-8');
  const parsed = JSON.parse(raw) as { profiles: unknown[] };
  return validateLegacyModuleProfiles(parsed.profiles);
}

export const LEGACY_MODULE_PROFILES: readonly LegacyModuleProfile[] = loadProfiles();

const PROFILE_BY_MODULE = new Map<string, LegacyModuleProfile>();
for (const profile of LEGACY_MODULE_PROFILES) {
  PROFILE_BY_MODULE.set(profile.modulePath, profile);
}

export function getLegacyModuleProfile(modulePath: string): LegacyModuleProfile | undefined {
  return PROFILE_BY_MODULE.get(modulePath);
}

export function getSafeLegacyProfiles(): LegacyModuleProfile[] {
  return LEGACY_MODULE_PROFILES.filter(p => p.importSafe && p.importStrategy === 'CREATE_REQUIRE');
}

export function getBlockedLegacyProfiles(): LegacyModuleProfile[] {
  return LEGACY_MODULE_PROFILES.filter(p => p.importStrategy === 'BLOCKED');
}

export function getUnsafeLegacyProfiles(): LegacyModuleProfile[] {
  return LEGACY_MODULE_PROFILES.filter(p => !p.importSafe && p.importStrategy !== 'BLOCKED');
}

export function getLegacyProfileSummary(): {
  total: number;
  safe: number;
  unsafe: number;
  blocked: number;
} {
  return {
    total: LEGACY_MODULE_PROFILES.length,
    safe: getSafeLegacyProfiles().length,
    unsafe: getUnsafeLegacyProfiles().length,
    blocked: getBlockedLegacyProfiles().length,
  };
}
