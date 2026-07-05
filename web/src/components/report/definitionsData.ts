import type { Mode } from '../../types';

export interface DomainDef {
  key: string;
  color: string;
  name: string;
  abbrev: string;
  description: string;
}

export interface BandData {
  y1: number;
  y2: number;
  color: string;
  label: string;
}

export interface SurfaceLabel {
  y: number;
  label: string;
  fullName: string;
}

export interface ColumnData {
  title: string;
  bands: BandData[];
  leftLabels: SurfaceLabel[];
  rightLabels: SurfaceLabel[];
}

const Y = [34, 79, 124, 169, 214];

function sl(y: number, label: string, fullName: string): SurfaceLabel {
  return { y, label, fullName };
}

export function getColumns(mode: Mode): [ColumnData, ColumnData] {
  if (mode === 'dig') {
    return [
      {
        title: 'Over-Excavated',
        bands: [
          { y1: Y[0], y2: Y[1], color: '#4a3aa7', label: 'Mined Before Start' },
          { y1: Y[1], y2: Y[2], color: '#2a78d6', label: 'Planned & Mined' },
          { y1: Y[2], y2: Y[3], color: '#e34948', label: 'Mined Not Planned' },
          { y1: Y[3], y2: Y[4], color: '#1baf7a', label: 'Ahead of Plan' },
        ],
        leftLabels: [
          sl(Y[0], 'SS', 'Schedule Start'),
          sl(Y[1], 'PS', 'Production Start'),
          sl(Y[2], 'SE', 'Schedule End'),
          sl(Y[3], 'PE', 'Production End'),
          sl(Y[4], 'SF', 'Schedule Future'),
        ],
        rightLabels: [],
      },
      {
        title: 'Under-Excavated',
        bands: [
          { y1: Y[0], y2: Y[1], color: '#eb6834', label: 'Preschedule Delay' },
          { y1: Y[1], y2: Y[2], color: '#2a78d6', label: 'Planned & Mined' },
          { y1: Y[2], y2: Y[3], color: '#eda100', label: 'Planned Not Mined' },
          { y1: Y[3], y2: Y[4], color: '#f4f4f2', label: '' },
        ],
        leftLabels: [],
        rightLabels: [
          sl(Y[0], 'PS', 'Production Start'),
          sl(Y[1], 'SS', 'Schedule Start'),
          sl(Y[2], 'PE', 'Production End'),
          sl(Y[3], 'SE', 'Schedule End'),
          sl(Y[4], 'SF', 'Schedule Future'),
        ],
      },
    ];
  }

  return [
    {
      title: 'Over-Dumped',
      bands: [
        { y1: Y[0], y2: Y[1], color: '#1baf7a', label: 'Dumped Ahead of Plan' },
        { y1: Y[1], y2: Y[2], color: '#e34948', label: 'Dumped Not Planned' },
        { y1: Y[2], y2: Y[3], color: '#2a78d6', label: 'Planned & Dumped' },
        { y1: Y[3], y2: Y[4], color: '#4a3aa7', label: 'Dumped Before Start' },
      ],
      leftLabels: [
        sl(Y[0], 'SF', 'Schedule Future'),
        sl(Y[1], 'PE', 'Production End'),
        sl(Y[2], 'SE', 'Schedule End'),
        sl(Y[3], 'PS', 'Production Start'),
        sl(Y[4], 'SS', 'Schedule Start'),
      ],
      rightLabels: [],
    },
    {
      title: 'Under-Dumped',
      bands: [
        { y1: Y[0], y2: Y[1], color: '#f4f4f2', label: '' },
        { y1: Y[1], y2: Y[2], color: '#eda100', label: 'Planned Not Dumped' },
        { y1: Y[2], y2: Y[3], color: '#2a78d6', label: 'Planned & Dumped' },
        { y1: Y[3], y2: Y[4], color: '#eb6834', label: 'Dump Preschedule Delay' },
      ],
      leftLabels: [],
      rightLabels: [
        sl(Y[0], 'SF', 'Schedule Future'),
        sl(Y[1], 'SE', 'Schedule End'),
        sl(Y[2], 'PE', 'Production End'),
        sl(Y[3], 'SS', 'Schedule Start'),
        sl(Y[4], 'PS', 'Production Start'),
      ],
    },
  ];
}

export function getDomainDefs(mode: Mode): DomainDef[] {
  if (mode === 'dig') {
    return [
      { key: 'PlannedAndMined', color: '#2a78d6', name: 'Planned and Mined', abbrev: 'PAM', description: 'Volume both scheduled and actually mined during this period' },
      { key: 'PlannedNotMined', color: '#eda100', name: 'Planned Not Mined', abbrev: 'PNM', description: 'Scheduled volume that was not excavated during this period' },
      { key: 'MinedNotPlanned', color: '#e34948', name: 'Mined Not Planned', abbrev: 'MNP', description: 'Volume mined that exceeded the schedule for this period' },
      { key: 'MinedBeforeStart', color: '#4a3aa7', name: 'Mined Before Start', abbrev: 'MBS', description: 'Volume already mined before the current schedule period commenced' },
      { key: 'PrescheduleDelay', color: '#eb6834', name: 'Preschedule Delay', abbrev: 'PSD', description: 'Scheduled volume not yet started due to production delays from earlier periods' },
      { key: 'AheadOfPlan', color: '#1baf7a', name: 'Ahead of Plan', abbrev: 'AOP', description: 'Volume mined beyond the current period into the future schedule' },
    ];
  }

  return [
    { key: 'PlannedAndDumped', color: '#2a78d6', name: 'Planned and Dumped', abbrev: 'PAD', description: 'Volume both scheduled and actually placed during this period' },
    { key: 'PlannedNotDumped', color: '#eda100', name: 'Planned Not Dumped', abbrev: 'PND', description: 'Scheduled volume that was not placed during this period' },
    { key: 'DumpedNotPlanned', color: '#e34948', name: 'Dumped Not Planned', abbrev: 'DNP', description: 'Volume dumped that exceeded the schedule for this period' },
    { key: 'DumpedBeforeStart', color: '#4a3aa7', name: 'Dumped Before Start', abbrev: 'DBS', description: 'Volume already dumped before the current schedule period commenced' },
    { key: 'DumpPrescheduleDelay', color: '#eb6834', name: 'Dump Preschedule Delay', abbrev: 'DPSD', description: 'Scheduled dump volume not yet placed due to production delays from earlier periods' },
    { key: 'DumpedAheadOfPlan', color: '#1baf7a', name: 'Dumped Ahead of Plan', abbrev: 'DAOP', description: 'Volume dumped beyond the current period into the future schedule' },
  ];
}
