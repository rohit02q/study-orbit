import { CURRENT_SCHEMA_VERSION, createDefaultData } from './schema.js';

/**
 * Each migration takes the full data object at version N and returns it
 * upgraded to version N+1. Migrations must be additive and defensive —
 * they run against real user backups that may predate a field entirely.
 */
const MIGRATIONS = {
  // 0 -> 1: introduce pausedIntervals/status on sessions, archived on subjects,
  // completedAt on todos, wordCount on notes. Represents "pre-schema" exports
  // that only had the loose shape described in the original project brief.
  0: (data) => {
    data.subjects = (data.subjects || []).map((s) => ({
      archived: false,
      ...s,
    }));

    data.studySessions = (data.studySessions || []).map((s) => ({
      ...s,
      pausedIntervals: s.pausedIntervals ?? [],
      status: s.status ?? (s.endTime ? 'completed' : 'running'),
      duration: s.duration ?? 0,
      goalNote: s.goalNote ?? '',
      sessionNote: s.sessionNote ?? '',
    }));

    data.todos = (data.todos || []).map((t) => ({
      ...t,
      completedAt: t.completedAt ?? (t.completed ? t.createdAt ?? null : null),
      dueDate: t.dueDate ?? null,
      subjectId: t.subjectId ?? null,
    }));

    data.notes = (data.notes || []).map((n) => ({
      ...n,
      wordCount: n.wordCount ?? 0,
      pinned: n.pinned ?? false,
    }));

    data.sleepRecords = data.sleepRecords || [];
    data.settings = {
      theme: 'dark',
      dailyGoalMinutes: 240,
      weeklyGoalMinutes: 1500,
      timerDefaults: { autoStartBreaks: false, soundOnComplete: true },
      demoDataActive: false,
      ...(data.settings || {}),
    };

    const now = new Date().toISOString();
    data.meta = {
      createdAt: now,
      lastUpdated: now,
      ...(data.meta || {}),
      version: 1,
    };
    return data;
  },
};

/**
 * Applies every migration between the data's current version and
 * CURRENT_SCHEMA_VERSION, in order. Returns { data, migrated, fromVersion }.
 * Data with no meta.version at all is treated as version 0.
 */
export function runMigrations(rawData) {
  let data = rawData;
  let version = typeof data?.meta?.version === 'number' ? data.meta.version : 0;
  const fromVersion = version;
  let migrated = false;

  while (version < CURRENT_SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) {
      // No migration path defined from this version — stop rather than guess.
      break;
    }
    data = step(data);
    migrated = true;
    version = data.meta.version;
  }

  // A brand-new top-level section (e.g. a collection added in a later
  // release) doesn't always warrant a schema version bump on its own —
  // this guarantees any such gap defaults cleanly instead of staying
  // `undefined`, regardless of whether a version-based migration ran above.
  const defaults = createDefaultData();
  Object.keys(defaults).forEach((key) => {
    if (data[key] === undefined) data[key] = defaults[key];
  });

  return { data, migrated, fromVersion, toVersion: version };
}
