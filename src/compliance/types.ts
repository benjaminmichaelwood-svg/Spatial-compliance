import { TriangulatedSurface } from '../engine/types';

export enum DomainType {
  PlannedAndMined = 'Planned & Mined',
  MinedNotPlanned = 'Mined Not Planned',
  PrescheduleDelay = 'Preschedule Delay',
  AheadOfPlan = 'Ahead of Plan',
  MinedBeforeStart = 'Mined Before Start',
  PlannedNotMined = 'Planned Not Mined',
  DumpPlannedAndMined = 'Dump: Planned & Mined',
  DumpMinedNotPlanned = 'Dump: Placed Not Planned',
  DumpPrescheduleDelay = 'Dump: Preschedule Delay',
  DumpAheadOfPlan = 'Dump: Ahead of Plan',
  DumpPlannedNotMined = 'Dump: Planned Not Placed',
}

export interface ConformanceDomain {
  type: DomainType;
  surface: TriangulatedSurface | null;
  volume: number;
  area: number;
  color: string;
  visible: boolean;
}

export interface ComplianceResult {
  domains: ConformanceDomain[];
  totalPlannedVolume: number;
  totalActualVolume: number;
  conformancePercent: number;
  timestamp: string;
}

export interface SurfaceInput {
  name: string;
  file: File;
  role: SurfaceRole;
  date?: string;
}

export type SurfaceRole =
  | 'pre-mining'
  | 'planned-eop'
  | 'actual-eop'
  | 'planned-dump'
  | 'actual-dump'
  | 'planned-start'
  | 'actual-start';

export const DOMAIN_COLORS: Record<DomainType, string> = {
  [DomainType.PlannedAndMined]: '#4CAF50',
  [DomainType.MinedNotPlanned]: '#F44336',
  [DomainType.PrescheduleDelay]: '#FF9800',
  [DomainType.AheadOfPlan]: '#2196F3',
  [DomainType.MinedBeforeStart]: '#9C27B0',
  [DomainType.PlannedNotMined]: '#FFEB3B',
  [DomainType.DumpPlannedAndMined]: '#66BB6A',
  [DomainType.DumpMinedNotPlanned]: '#EF5350',
  [DomainType.DumpPrescheduleDelay]: '#FFA726',
  [DomainType.DumpAheadOfPlan]: '#42A5F5',
  [DomainType.DumpPlannedNotMined]: '#FFF176',
};
