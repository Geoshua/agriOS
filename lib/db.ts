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
          notes TEXT
        );
      `);
      db = instance;
      return db;
    })();
  }
  return dbReady;
}

export async function logIssue(issue: Omit<IssueRecord, 'id'>): Promise<number> {
  const db = await getDb();
  const result = await db.runAsync(
    `INSERT INTO issues (disease_id, disease_name, severity, confidence, lat, lng, photo_uri, timestamp, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  };
}
