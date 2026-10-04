import * as SQLite from 'expo-sqlite';
import { DEMO_MODE } from './config';

export interface IssueRecord {
  id: number;
  diseaseId: string;
  diseaseName: string;
  severity: string;
  confidence: number;
  lat: number;
  lng: number;
  photoUri: string | null;
  timestamp: number;
  notes: string | null;
  /** Field block the issue was logged in, e.g. "C". Null for rows logged before blocks existed. */
  block: string | null;
  plantId: number | null;
  /** 'seed' = demo history (replaced on reseed); 'user' = logged by the farmer. */
  source?: 'user' | 'seed';
}

/** A tagged tree. Untagged scans just belong to their block. */
export interface PlantRecord {
  id: number;
  name: string;
  /** Number painted on the tree's tag (null for trees from older builds). */
  tag: number | null;
  block: string | null;
  lat: number;
  lng: number;
  createdAt: number;
  source?: 'user' | 'seed';
}

export type ActionType = 'sprayed' | 'pruned' | 'fertilised' | 'removed_leaves' | 'watered' | 'rained' | 'none';

/** Actions that treat a disease (watering / rain are care, not treatment). */
export const TREATMENT_ACTIONS: ActionType[] = ['sprayed', 'pruned', 'fertilised', 'removed_leaves'];

/** Something the farmer did after advice — the outcome signal for insights and learning. */
export interface ActionRecord {
  id: number;
  type: ActionType;
  plantId: number | null;
  block: string | null;
  /** Scan that prompted the action, if any. */
  issueId: number | null;
  /** Disease being treated (from that scan), if any. */
  diseaseId: string | null;
  timestamp: number;
  source?: 'user' | 'seed';
  /** Uploaded to the hub's outcome stats. */
  synced?: boolean;
}

export interface PendingOffload {
  id: number;
  framePath: string;
  diseaseId: string;
  confidence: number;
  lat: number | null;
  lng: number | null;
  createdAt: number;
  status: 'pending' | 'processing';
}

let db: SQLite.SQLiteDatabase | null = null;
let dbReady: Promise<SQLite.SQLiteDatabase> | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  if (!dbReady) {
    dbReady = (async () => {
      const instance = await SQLite.openDatabaseAsync('agriOS.db');
      await instance.execAsync(`
        CREATE TABLE IF NOT EXISTS issues (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          disease_id TEXT NOT NULL,
          disease_name TEXT NOT NULL,
          severity TEXT NOT NULL,
          confidence REAL NOT NULL,
          lat REAL NOT NULL,
          lng REAL NOT NULL,
          photo_uri TEXT,
          timestamp INTEGER NOT NULL,
          notes TEXT,
          block TEXT
        );
        CREATE TABLE IF NOT EXISTS plants (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          lat REAL NOT NULL,
          lng REAL NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS actions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT NOT NULL,
          plant_id INTEGER,
          block TEXT,
          issue_id INTEGER,
          disease_id TEXT,
          timestamp INTEGER NOT NULL,
          source TEXT NOT NULL DEFAULT 'user',
          synced INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS pending_offloads (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          frame_path TEXT NOT NULL,
          disease_id TEXT NOT NULL,
          confidence REAL NOT NULL,
          lat REAL,
          lng REAL,
          created_at INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending'
        );
        -- Watering & to-do (lib/watering.ts, lib/tasks.ts)
        CREATE TABLE IF NOT EXISTS watering_plans (
          subject_type TEXT NOT NULL,
          subject_id TEXT NOT NULL,
          every_days INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (subject_type, subject_id)
        );
        CREATE TABLE IF NOT EXISTS tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          plant_id INTEGER,
          block TEXT,
          due_at INTEGER NOT NULL,
          repeat_days INTEGER,
          done_at INTEGER,
          last_done_at INTEGER,
          created_at INTEGER NOT NULL,
          notes TEXT
        );
        CREATE TABLE IF NOT EXISTS task_marks (
          key TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          until INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          title TEXT,
          plant_id INTEGER,
          block TEXT,
          action_id INTEGER
        );
      `);
      // Migrate databases created before the block / plant_id columns existed.
      const cols = await instance.getAllAsync<{ name: string }>('PRAGMA table_info(issues)');
      if (!cols.some((c) => c.name === 'block')) {
        await instance.execAsync('ALTER TABLE issues ADD COLUMN block TEXT');
      }
      if (!cols.some((c) => c.name === 'plant_id')) {
        await instance.execAsync('ALTER TABLE issues ADD COLUMN plant_id INTEGER');
      }
      if (!cols.some((c) => c.name === 'source')) {
        await instance.execAsync("ALTER TABLE issues ADD COLUMN source TEXT NOT NULL DEFAULT 'user'");
        // Demo history seeded by older builds has no photo and no tree. Label it
        // once, here, before any scan from this build exists — so later cleanups
        // can rely on `source` and never guess.
        if (DEMO_MODE) {
          await instance.execAsync("UPDATE issues SET source = 'seed' WHERE photo_uri IS NULL AND plant_id IS NULL");
        }
      }
      const plantCols = await instance.getAllAsync<{ name: string }>('PRAGMA table_info(plants)');
      if (!plantCols.some((c) => c.name === 'tag')) await instance.execAsync('ALTER TABLE plants ADD COLUMN tag INTEGER');
      if (!plantCols.some((c) => c.name === 'block')) await instance.execAsync('ALTER TABLE plants ADD COLUMN block TEXT');
      if (!plantCols.some((c) => c.name === 'source')) {
        await instance.execAsync("ALTER TABLE plants ADD COLUMN source TEXT NOT NULL DEFAULT 'user'");
      }
      // One tree per tag number.
      try {
        await instance.execAsync('CREATE UNIQUE INDEX IF NOT EXISTS plants_tag_unique ON plants(tag) WHERE tag IS NOT NULL');
      } catch {
        // Existing duplicate tags from an old build — leave as is rather than fail to open.
      }
      db = instance;
      return db;
    })();
  }
  return dbReady;
}

// ── Issues ────────────────────────────────────────────────────────────────────

export async function logIssue(issue: Omit<IssueRecord, 'id'>): Promise<number> {
  const db = await getDb();
  const result = await db.runAsync(
    `INSERT INTO issues (disease_id, disease_name, severity, confidence, lat, lng, photo_uri, timestamp, notes, block, plant_id, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      issue.diseaseId,
      issue.diseaseName,
      issue.severity,
      issue.confidence,
      issue.lat,
      issue.lng,
      issue.photoUri ?? null,
      issue.timestamp,
      issue.notes ?? null,
      issue.block ?? null,
      issue.plantId ?? null,
      issue.source ?? 'user',
    ]
  );
  return result.lastInsertRowId;
}

export async function getTodayIssues(): Promise<IssueRecord[]> {
  const db = await getDb();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM issues WHERE timestamp >= ? ORDER BY timestamp DESC`,
    [startOfDay.getTime()]
  );
  return rows.map(rowToRecord);
}

export async function getAllIssues(): Promise<IssueRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM issues ORDER BY timestamp DESC`
  );
  return rows.map(rowToRecord);
}

export async function getIssuesByDateRange(from: number, to: number): Promise<IssueRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM issues WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp DESC`,
    [from, to]
  );
  return rows.map(rowToRecord);
}

export async function getIssuesByPlant(plantId: number): Promise<IssueRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM issues WHERE plant_id = ? ORDER BY timestamp ASC`,
    [plantId]
  );
  return rows.map(rowToRecord);
}

function rowToRecord(row: any): IssueRecord {
  return {
    id: row.id,
    diseaseId: row.disease_id,
    diseaseName: row.disease_name,
    severity: row.severity,
    confidence: row.confidence,
    lat: row.lat,
    lng: row.lng,
    photoUri: row.photo_uri,
    timestamp: row.timestamp,
    notes: row.notes,
    block: row.block ?? null,
    plantId: row.plant_id ?? null,
    source: row.source ?? 'user',
  };
}

export async function getIssuesByBlock(block: string): Promise<IssueRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(`SELECT * FROM issues WHERE block = ? ORDER BY timestamp ASC`, [block]);
  return rows.map(rowToRecord);
}

export async function getIssue(id: number): Promise<IssueRecord | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<any>(`SELECT * FROM issues WHERE id = ?`, [id]);
  return row ? rowToRecord(row) : null;
}

/** Tag (or untag with null) a logged scan. */
export async function setIssuePlant(issueId: number, plantId: number | null): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE issues SET plant_id = ? WHERE id = ?`, [plantId, issueId]);
}

/** Removes a scan (e.g. a false positive). Returns its photo URI so the caller can delete the file. */
export async function deleteIssue(id: number): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ photo_uri: string | null }>(`SELECT photo_uri FROM issues WHERE id = ?`, [id]);
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync(`DELETE FROM issues WHERE id = ?`, [id]);
    // Actions prompted by a removed scan lose their link but stay as history.
    await txn.runAsync(`UPDATE actions SET issue_id = NULL WHERE issue_id = ?`, [id]);
  });
  return row?.photo_uri ?? null;
}

/** Photo URIs of user scans, oldest first (for pruning stored photos). */
export async function getUserPhotoUris(): Promise<{ id: number; photoUri: string }[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: number; photo_uri: string }>(
    `SELECT id, photo_uri FROM issues WHERE photo_uri IS NOT NULL AND source = 'user' ORDER BY timestamp ASC`,
  );
  return rows.map((r) => ({ id: r.id, photoUri: r.photo_uri }));
}

export async function clearIssuePhoto(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE issues SET photo_uri = NULL WHERE id = ?`, [id]);
}

// ── Actions ───────────────────────────────────────────────────────────────────

export async function logAction(action: Omit<ActionRecord, 'id'>): Promise<number> {
  const db = await getDb();
  const result = await db.runAsync(
    `INSERT INTO actions (type, plant_id, block, issue_id, disease_id, timestamp, source, synced) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [action.type, action.plantId, action.block, action.issueId, action.diseaseId, action.timestamp, action.source ?? 'user', action.synced ? 1 : 0],
  );
  return result.lastInsertRowId;
}

function rowToAction(row: any): ActionRecord {
  return {
    id: row.id,
    type: row.type,
    plantId: row.plant_id ?? null,
    block: row.block ?? null,
    issueId: row.issue_id ?? null,
    diseaseId: row.disease_id ?? null,
    timestamp: row.timestamp,
    source: row.source ?? 'user',
    synced: !!row.synced,
  };
}

export async function getAllActions(): Promise<ActionRecord[]> {
  const db = await getDb();
  return (await db.getAllAsync<any>(`SELECT * FROM actions ORDER BY timestamp ASC`)).map(rowToAction);
}

export async function deleteAction(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM actions WHERE id = ?`, [id]);
}

export async function markActionsSynced(ids: number[]): Promise<void> {
  if (!ids.length) return;
  const db = await getDb();
  await db.runAsync(`UPDATE actions SET synced = 1 WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
}

export async function countSeedRows(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(`SELECT (SELECT COUNT(*) FROM issues WHERE source = 'seed') + (SELECT COUNT(*) FROM plants WHERE source = 'seed') AS n`);
  return row?.n ?? 0;
}

/** Removes all demo-seeded history (issues, actions, trees) before a reseed. */
export async function deleteSeedData(): Promise<void> {
  const db = await getDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    // The farmer's own rows that point at demo trees lose the link (like deletePlant).
    const seedTrees = `SELECT id FROM plants WHERE source = 'seed'`;
    await txn.runAsync(`UPDATE issues SET plant_id = NULL WHERE source != 'seed' AND plant_id IN (${seedTrees})`);
    await txn.runAsync(`UPDATE actions SET plant_id = NULL WHERE source != 'seed' AND plant_id IN (${seedTrees})`);
    await txn.runAsync(`UPDATE tasks SET plant_id = NULL WHERE plant_id IN (${seedTrees})`);
    await txn.runAsync(`DELETE FROM watering_plans WHERE subject_type = 'plant' AND subject_id IN (SELECT CAST(id AS TEXT) FROM plants WHERE source = 'seed')`);
    await txn.runAsync(`DELETE FROM issues WHERE source = 'seed'`);
    await txn.runAsync(`DELETE FROM actions WHERE source = 'seed'`);
    await txn.runAsync(`DELETE FROM plants WHERE source = 'seed'`);
  });
}


export async function countIssues(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM issues');
  return row?.n ?? 0;
}



/** Bulk insert in one transaction (used by the demo seeder). */
export async function insertIssues(issues: Omit<IssueRecord, 'id'>[]): Promise<void> {
  const db = await getDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const issue of issues) {
      await txn.runAsync(
        `INSERT INTO issues (disease_id, disease_name, severity, confidence, lat, lng, photo_uri, timestamp, notes, block, plant_id, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          issue.diseaseId,
          issue.diseaseName,
          issue.severity,
          issue.confidence,
          issue.lat,
          issue.lng,
          issue.photoUri ?? null,
          issue.timestamp,
          issue.notes ?? null,
          issue.block ?? null,
          issue.plantId ?? null,
          issue.source ?? 'user',
        ],
      );
    }
  });
}

// ── Plants ────────────────────────────────────────────────────────────────────

export async function createPlant(
  name: string,
  lat: number,
  lng: number,
  extra: { tag?: number | null; block?: string | null; source?: 'user' | 'seed'; createdAt?: number } = {},
): Promise<number> {
  const db = await getDb();
  const result = await db.runAsync(
    `INSERT INTO plants (name, lat, lng, created_at, tag, block, source) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [name, lat, lng, extra.createdAt ?? Date.now(), extra.tag ?? null, extra.block ?? null, extra.source ?? 'user']
  );
  return result.lastInsertRowId;
}

/** Next free tag number (tags are farm-wide: Tree 1, Tree 2, …). */
export async function nextTagNumber(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number | null }>(`SELECT MAX(tag) AS n FROM plants`);
  return (row?.n ?? 0) + 1;
}

export async function getPlant(id: number): Promise<PlantRecord | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<any>(`SELECT * FROM plants WHERE id = ?`, [id]);
  return row ? rowToPlant(row) : null;
}

export async function deletePlant(id: number): Promise<void> {
  const db = await getDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync(`UPDATE issues SET plant_id = NULL WHERE plant_id = ?`, [id]);
    await txn.runAsync(`UPDATE actions SET plant_id = NULL WHERE plant_id = ?`, [id]);
    await txn.runAsync(`DELETE FROM plants WHERE id = ?`, [id]);
  });
}

function rowToPlant(r: any): PlantRecord {
  return {
    id: r.id,
    name: r.name,
    tag: r.tag ?? null,
    block: r.block ?? null,
    lat: r.lat,
    lng: r.lng,
    createdAt: r.created_at,
    source: r.source ?? 'user',
  };
}

export async function getAllPlants(): Promise<PlantRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM plants ORDER BY created_at ASC`
  );
  return rows.map(rowToPlant);
}

export async function renamePlant(plantId: number, name: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE plants SET name = ? WHERE id = ?`, [name, plantId]);
}

/** Returns the nearest plant within radiusMeters, or null if none. */
export async function findNearestPlant(
  lat: number,
  lng: number,
  radiusMeters: number,
): Promise<PlantRecord | null> {
  const plants = await getAllPlants();
  let nearest: PlantRecord | null = null;
  let nearestDist = Infinity;

  for (const plant of plants) {
    const dist = haversineMeters(lat, lng, plant.lat, plant.lng);
    if (dist < radiusMeters && dist < nearestDist) {
      nearest = plant;
      nearestDist = dist;
    }
  }

  return nearest;
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Auto-generate next plant name: Plant A, Plant B, … Plant Z, Plant 27, … */
export function nextPlantName(existingCount: number): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return existingCount < 26
    ? `Plant ${letters[existingCount]}`
    : `Plant ${existingCount + 1}`;
}

// ── Pending offloads (cloud retry queue) ─────────────────────────────────────

export async function queueOffload(entry: Omit<PendingOffload, 'id'>): Promise<number> {
  const db = await getDb();
  const result = await db.runAsync(
    `INSERT INTO pending_offloads (frame_path, disease_id, confidence, lat, lng, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [entry.framePath, entry.diseaseId, entry.confidence, entry.lat, entry.lng, entry.createdAt, entry.status]
  );
  return result.lastInsertRowId;
}

export async function getPendingOffloads(): Promise<PendingOffload[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM pending_offloads WHERE status = 'pending' ORDER BY created_at ASC LIMIT 20`
  );
  return rows.map(r => ({
    id: r.id,
    framePath: r.frame_path,
    diseaseId: r.disease_id,
    confidence: r.confidence,
    lat: r.lat ?? null,
    lng: r.lng ?? null,
    createdAt: r.created_at,
    status: r.status,
  }));
}

export async function resolveOffload(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM pending_offloads WHERE id = ?`, [id]);
}

// ══ Watering plans, to-do tasks and task marks ═══════════════════════════════
// Owned by the watering / to-do feature (lib/watering.ts, lib/tasks.ts,
// components/tasks/*). Pure logic lives in those modules; this is storage only.

/** How often a block (or one tree, overriding its block) should be watered. */
export interface WateringPlanRecord {
  subjectType: 'block' | 'plant';
  /** Block letter ("C") or plant id as a string ("12"). */
  subjectId: string;
  everyDays: number;
  updatedAt: number;
}

/** A to-do the farmer added herself. */
export interface TaskRecord {
  id: number;
  title: string;
  plantId: number | null;
  block: string | null;
  dueAt: number;
  /** Repeat every N days (null = once). Completing a repeating task moves dueAt forward. */
  repeatDays: number | null;
  /** Set when a one-off task is done. Repeating tasks keep this null. */
  doneAt: number | null;
  /** Last completion of a repeating task (for the "Done" list). */
  lastDoneAt: number | null;
  createdAt: number;
  notes: string | null;
}

/**
 * Snooze / handled marker for a *derived* task (watering due, an insight
 * suggestion), which is computed and never stored itself. Hidden until `until`.
 */
export interface TaskMark {
  key: string;
  kind: 'snooze' | 'done';
  until: number;
  createdAt: number;
  /** Shown in the "Done" list. */
  title: string | null;
  plantId: number | null;
  block: string | null;
  /** Action logged when it was completed (deleted again on undo). */
  actionId: number | null;
}

export async function getWateringPlans(): Promise<WateringPlanRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(`SELECT * FROM watering_plans`);
  return rows.map((r) => ({ subjectType: r.subject_type, subjectId: String(r.subject_id), everyDays: r.every_days, updatedAt: r.updated_at }));
}

export async function setWateringPlan(subjectType: 'block' | 'plant', subjectId: string, everyDays: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO watering_plans (subject_type, subject_id, every_days, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(subject_type, subject_id) DO UPDATE SET every_days = excluded.every_days, updated_at = excluded.updated_at`,
    [subjectType, subjectId, Math.round(everyDays), Date.now()],
  );
}

/** Removes a tree's own plan so it follows its block again. */
export async function deleteWateringPlan(subjectType: 'block' | 'plant', subjectId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM watering_plans WHERE subject_type = ? AND subject_id = ?`, [subjectType, subjectId]);
}

function rowToTask(r: any): TaskRecord {
  return {
    id: r.id,
    title: r.title,
    plantId: r.plant_id ?? null,
    block: r.block ?? null,
    dueAt: r.due_at,
    repeatDays: r.repeat_days ?? null,
    doneAt: r.done_at ?? null,
    lastDoneAt: r.last_done_at ?? null,
    createdAt: r.created_at,
    notes: r.notes ?? null,
  };
}

export async function getTasks(): Promise<TaskRecord[]> {
  const db = await getDb();
  return (await db.getAllAsync<any>(`SELECT * FROM tasks ORDER BY due_at ASC`)).map(rowToTask);
}

export async function addTask(task: Omit<TaskRecord, 'id' | 'createdAt' | 'doneAt' | 'lastDoneAt'> & { createdAt?: number }): Promise<number> {
  const db = await getDb();
  const result = await db.runAsync(
    `INSERT INTO tasks (title, plant_id, block, due_at, repeat_days, done_at, last_done_at, created_at, notes) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
    [task.title, task.plantId, task.block, task.dueAt, task.repeatDays, task.createdAt ?? Date.now(), task.notes],
  );
  return result.lastInsertRowId;
}

/** Updates due date / completion fields (complete, snooze, undo). */
export async function updateTask(id: number, patch: Partial<Pick<TaskRecord, 'dueAt' | 'doneAt' | 'lastDoneAt' | 'title' | 'notes'>>): Promise<void> {
  const cols: Record<string, string> = { dueAt: 'due_at', doneAt: 'done_at', lastDoneAt: 'last_done_at', title: 'title', notes: 'notes' };
  const keys = Object.keys(patch).filter((k) => k in cols) as (keyof typeof patch)[];
  if (!keys.length) return;
  const db = await getDb();
  await db.runAsync(
    `UPDATE tasks SET ${keys.map((k) => `${cols[k]} = ?`).join(', ')} WHERE id = ?`,
    [...keys.map((k) => (patch[k] ?? null) as string | number | null), id],
  );
}

export async function deleteTask(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM tasks WHERE id = ?`, [id]);
}

/** Marks that still matter: active ones, plus "done" ones from the last `keepDays` (for the Done list). */
export async function getTaskMarks(now = Date.now(), keepDays = 8): Promise<TaskMark[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(`SELECT * FROM task_marks WHERE until > ? OR created_at > ?`, [now, now - keepDays * 86_400_000]);
  return rows.map((r) => ({
    key: r.key,
    kind: r.kind,
    until: r.until,
    createdAt: r.created_at,
    title: r.title ?? null,
    plantId: r.plant_id ?? null,
    block: r.block ?? null,
    actionId: r.action_id ?? null,
  }));
}

export async function setTaskMark(mark: TaskMark): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO task_marks (key, kind, until, created_at, title, plant_id, block, action_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [mark.key, mark.kind, mark.until, mark.createdAt, mark.title, mark.plantId, mark.block, mark.actionId],
  );
}

export async function deleteTaskMark(key: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM task_marks WHERE key = ?`, [key]);
}

/** Drops marks that expired more than `days` ago (housekeeping). */
export async function pruneTaskMarks(now = Date.now(), days = 30): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM task_marks WHERE until < ? AND created_at < ?`, [now - days * 86_400_000, now - days * 86_400_000]);
}
