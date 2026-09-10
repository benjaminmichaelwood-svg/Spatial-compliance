import { describe, it, expect } from 'vitest';
import { buildWaterfallData } from './WaterfallChart';
import type { DomainSolid } from '../../types';

// These totals must mirror classify.rs's ConformanceSummary formulas exactly
// (see the comment above getWaterfallSteps in WaterfallChart.tsx) — this was
// the exact bug fixed in Priority 4 (waterfall disagreeing with the sidebar
// summary and PPTX donut gauges over MinedBeforeStart's sign and the
// planned/actual totals). These tests pin that fix down as a regression
// guard.

function domain(domain: string, volume: number): DomainSolid {
  return {
    domain,
    label: domain,
    color: '#000000',
    solid: { label: domain, vertices: [], indices: [], volume, surface_area: 0 },
    volume,
  };
}

function totalsOf(items: ReturnType<typeof buildWaterfallData>) {
  const planned = items.find((i) => i.name === 'Planned');
  const final = items.find((i) => i.name === 'Production' || i.name === 'Total');
  return { plannedTotal: planned?.total, finalTotal: final?.total };
}

describe('buildWaterfallData (dig mode)', () => {
  it('matches classify.rs total_planned_volume = PAM + PNM + MBS', () => {
    const domains = [
      domain('PlannedAndMined', 1000),
      domain('PlannedNotMined', 500),
      domain('MinedBeforeStart', 200),
    ];
    const items = buildWaterfallData(domains, 'dig');
    const { plannedTotal } = totalsOf(items);
    expect(plannedTotal).toBeCloseTo(1000 + 500 + 200);
  });

  it('matches classify.rs total_actual_volume = PAM + MNP + PrescheduleDelay + AheadOfPlan', () => {
    const domains = [
      domain('PlannedAndMined', 1000),
      domain('PlannedNotMined', 500),
      domain('MinedBeforeStart', 200),
      domain('MinedNotPlanned', 300),
      domain('PrescheduleDelay', 150),
      domain('AheadOfPlan', 100),
    ];
    const items = buildWaterfallData(domains, 'dig');
    const { finalTotal } = totalsOf(items);
    expect(finalTotal).toBeCloseTo(1000 + 300 + 150 + 100);
  });

  it('subtracts MinedBeforeStart from the planned baseline, not adds it (the Priority 4 sign bug)', () => {
    const domains = [domain('PlannedAndMined', 1000), domain('MinedBeforeStart', 400)];
    const items = buildWaterfallData(domains, 'dig');
    const mbsStep = items.find((i) => i.name === 'Mined Before Start');
    expect(mbsStep).toBeDefined();
    // MBS must move the running total DOWN from the planned baseline.
    expect(mbsStep!.total).toBeLessThan(1000 + 400);
    expect(mbsStep!.total).toBeCloseTo(1000);
  });

  it('produces zero-length output for no domains', () => {
    const items = buildWaterfallData([], 'dig');
    expect(items).toEqual([]);
  });

  it('sums multiple solids in the same domain', () => {
    const domains = [
      domain('PlannedAndMined', 300),
      domain('PlannedAndMined', 700),
    ];
    const items = buildWaterfallData(domains, 'dig');
    const { plannedTotal } = totalsOf(items);
    expect(plannedTotal).toBeCloseTo(1000);
  });
});

describe('buildWaterfallData (dump mode)', () => {
  it('matches classify.rs total_planned_volume = PAD + PND + DumpedBeforeStart', () => {
    const domains = [
      domain('PlannedAndDumped', 1000),
      domain('PlannedNotDumped', 400),
      domain('DumpedBeforeStart', 100),
    ];
    const items = buildWaterfallData(domains, 'dump');
    const { plannedTotal } = totalsOf(items);
    expect(plannedTotal).toBeCloseTo(1000 + 400 + 100);
  });

  it('matches classify.rs total_actual_volume = PAD + DNP + DumpPrescheduleDelay + DumpedAheadOfPlan', () => {
    const domains = [
      domain('PlannedAndDumped', 1000),
      domain('DumpedNotPlanned', 250),
      domain('DumpPrescheduleDelay', 50),
      domain('DumpedAheadOfPlan', 75),
    ];
    const items = buildWaterfallData(domains, 'dump');
    const { finalTotal } = totalsOf(items);
    expect(finalTotal).toBeCloseTo(1000 + 250 + 50 + 75);
  });
});
