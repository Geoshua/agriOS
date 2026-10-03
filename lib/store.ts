import { create } from 'zustand';
import { IssueRecord } from './db';
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
}

export const useShambaStore = create<ShambaStore>((set) => ({
  currentDetection: null,
  setCurrentDetection: (d) => set({ currentDetection: d }),

  issues: [],
  addIssue: (issue) => set((state) => ({ issues: [issue, ...state.issues] })),
  setIssues: (issues) => set({ issues }),

  isScanning: true,
  setIsScanning: (scanning) => set({ isScanning: scanning }),

  scanMode: 'ar',
  setScanMode: (mode) => set({ scanMode: mode }),
  torch: false,
  setTorch: (on) => set({ torch: on }),
  activeBlock: 'C',
  setActiveBlock: (block) => set({ activeBlock: block }),
}));
