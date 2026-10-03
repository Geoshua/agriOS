import { create } from 'zustand';
import { IssueRecord, PlantRecord } from './db';
import { InferenceResult } from './inference';

interface Detection {
  result: InferenceResult;
  timestamp: number;
}

interface ShambaStore {
  // Current detection from camera
  currentDetection: Detection | null;
  setCurrentDetection: (d: Detection | null) => void;

  // Advisory sheet
  advisoryOpen: boolean;
  setAdvisoryOpen: (open: boolean) => void;

  // Logged issues (in-memory mirror of SQLite)
  issues: IssueRecord[];
  addIssue: (issue: IssueRecord) => void;
  setIssues: (issues: IssueRecord[]) => void;

  // Tracked plants (in-memory mirror of SQLite)
  plants: PlantRecord[];
  addPlant: (plant: PlantRecord) => void;
  setPlants: (plants: PlantRecord[]) => void;

  // Camera scanning state
  isScanning: boolean;
  setIsScanning: (scanning: boolean) => void;
}

export const useShambaStore = create<ShambaStore>((set) => ({
  currentDetection: null,
  setCurrentDetection: (d) => set({ currentDetection: d }),

  advisoryOpen: false,
  setAdvisoryOpen: (open) => set({ advisoryOpen: open }),

  issues: [],
  addIssue: (issue) => set((state) => ({ issues: [issue, ...state.issues] })),
  setIssues: (issues) => set({ issues }),

  plants: [],
  addPlant: (plant) => set((state) => ({ plants: [...state.plants, plant] })),
  setPlants: (plants) => set({ plants }),

  isScanning: true,
  setIsScanning: (scanning) => set({ isScanning: scanning }),
}));
