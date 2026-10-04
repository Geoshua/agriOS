import { create } from 'zustand';
import { IssueRecord, PlantRecord } from './db';
import { InferenceResult } from './inference';

interface Detection {
  result: InferenceResult;
  timestamp: number;
}

export type ScanMode = 'ar' | 'camera' | 'details';

export const FIELD_BLOCKS = ['A', 'B', 'C', 'D'] as const;
export type FieldBlock = (typeof FIELD_BLOCKS)[number];

interface ShambaStore {
  // Current detection from camera
  currentDetection: Detection | null;
  setCurrentDetection: (d: Detection | null) => void;

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

  // Scan screen controls. 'details' = the advisory sheet is up (scanning pauses).
  scanMode: ScanMode;
  setScanMode: (mode: ScanMode) => void;
  torch: boolean;
  setTorch: (on: boolean) => void;
  activeBlock: FieldBlock;
  setActiveBlock: (block: FieldBlock) => void;

  // Last captured frame URI — used by AdvisorySheet for cloud offload queuing
  lastFrameUri: string | null;
  setLastFrameUri: (uri: string | null) => void;

  // Last known GPS — updated every 30s, passed to /classify for data contribution
  lastKnownLocation: { lat: number; lng: number } | null;
  setLastKnownLocation: (loc: { lat: number; lng: number } | null) => void;

  // Demo map scenario (lib/demoScenario.ts) — shared by the map and settings.
  demoMode: boolean;
  setDemoMode: (on: boolean) => void;
}

export const useShambaStore = create<ShambaStore>((set) => ({
  currentDetection: null,
  setCurrentDetection: (d) => set({ currentDetection: d }),

  issues: [],
  addIssue: (issue) => set((state) => ({ issues: [issue, ...state.issues] })),
  setIssues: (issues) => set({ issues }),

  plants: [],
  addPlant: (plant) => set((state) => ({ plants: [...state.plants, plant] })),
  setPlants: (plants) => set({ plants }),

  isScanning: true,
  setIsScanning: (scanning) => set({ isScanning: scanning }),

  scanMode: 'ar',
  setScanMode: (mode) => set({ scanMode: mode }),
  torch: false,
  setTorch: (on) => set({ torch: on }),
  activeBlock: 'C',
  setActiveBlock: (block) => set({ activeBlock: block }),

  lastFrameUri: null,
  setLastFrameUri: (uri) => set({ lastFrameUri: uri }),

  lastKnownLocation: null,
  setLastKnownLocation: (loc) => set({ lastKnownLocation: loc }),

  demoMode: false,
  setDemoMode: (on) => set({ demoMode: on }),
}));
