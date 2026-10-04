import * as SQLite from 'expo-sqlite';

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
}

export interface PlantRecord {
  id: number;
  name: string;
  lat: number;
  lng: number;
  createdAt: number;
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
      `);
      // Migrate databases created before the block / plant_id columns existed.
      const cols = await instance.getAllAsync<{ name: string }>('PRAGMA table_info(issues)');
      if (!cols.some((c) => c.name === 'block')) {
        await instance.execAsync('ALTER TABLE issues ADD COLUMN block TEXT');
      }
      if (!cols.some((c) => c.name === 'plant_id')) {
        await instance.execAsync('ALTER TABLE issues ADD COLUMN plant_id INTEGER');
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
    `INSERT INTO issues (disease_id, disease_name, severity, confidence, lat, lng, photo_uri, timestamp, notes, block, plant_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  };
}

export async function countIssues(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM issues');
  return row?.n ?? 0;
}

/** Bulk insert in one transaction (used by the demo seeder). */
export async function insertIssues(issues: Omit<IssueRecord, 'id'>[]): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const issue of issues) {
      await db.runAsync(
        `INSERT INTO issues (disease_id, disease_name, severity, confidence, lat, lng, photo_uri, timestamp, notes, block, plant_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        ],
      );
    }
  });
}

// ── Plants ────────────────────────────────────────────────────────────────────

export async function createPlant(name: string, lat: number, lng: number): Promise<number> {
  const db = await getDb();
  const result = await db.runAsync(
    `INSERT INTO plants (name, lat, lng, created_at) VALUES (?, ?, ?, ?)`,
    [name, lat, lng, Date.now()]
  );
  return result.lastInsertRowId;
}

export async function getAllPlants(): Promise<PlantRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM plants ORDER BY created_at ASC`
  );
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    lat: r.lat,
    lng: r.lng,
    createdAt: r.created_at,
  }));
}

export async function renamePatient(plantId: number, name: string): Promise<void> {
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
