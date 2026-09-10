use super::{Domain, Interval};

// ---------------------------------------------------------------------------
// Dump-mode per-cell / per-vertex classification (mirror of dig.rs)
// ---------------------------------------------------------------------------

pub(super) fn classify_cell_dump(
    ps: f64,
    pe: f64,
    ss: f64,
    se: f64,
    sf: Option<f64>,
) -> Vec<Interval> {
    let mut out = Vec::with_capacity(4);
    let eps = 1e-9;

    if ps > ss + eps {
        out.push(Interval {
            domain: Domain::DumpedBeforeStart,
            upper: ps,
            lower: ss,
        });
    }

    if ps < ss - eps {
        out.push(Interval {
            domain: Domain::DumpPrescheduleDelay,
            upper: ss,
            lower: ps,
        });
    }

    let pad_lower = ps.max(ss);
    let pad_upper = pe.min(se);
    if pad_upper > pad_lower + eps {
        out.push(Interval {
            domain: Domain::PlannedAndDumped,
            upper: pad_upper,
            lower: pad_lower,
        });
    }

    if pe < se - eps {
        let pnd_lower = pe.max(ps.max(ss));
        let pnd_upper = se;
        if pnd_upper > pnd_lower + eps {
            out.push(Interval {
                domain: Domain::PlannedNotDumped,
                upper: pnd_upper,
                lower: pnd_lower,
            });
        }
    }

    if pe > se + eps {
        match sf {
            Some(sf_val) if sf_val > se => {
                let aop_upper = pe.min(sf_val);
                if aop_upper > se + eps {
                    out.push(Interval {
                        domain: Domain::DumpedAheadOfPlan,
                        upper: aop_upper,
                        lower: se,
                    });
                }
                if pe > sf_val + eps {
                    out.push(Interval {
                        domain: Domain::DumpedNotPlanned,
                        upper: pe,
                        lower: sf_val,
                    });
                }
            }
            _ => {
                out.push(Interval {
                    domain: Domain::DumpedNotPlanned,
                    upper: pe,
                    lower: se,
                });
            }
        }
    }

    out
}

pub(super) fn per_vertex_bounds_dump(domain: Domain, ps: f64, pe: f64, ss: f64, se: f64, sf: Option<f64>) -> (f64, f64) {
    match domain {
        Domain::DumpedBeforeStart => (ps, ss),
        Domain::DumpPrescheduleDelay => (ss, ps),
        Domain::PlannedAndDumped => (pe.min(se), ps.max(ss)),
        Domain::PlannedNotDumped => (se, pe.max(ps.max(ss))),
        Domain::DumpedNotPlanned => {
            match sf {
                Some(sf_val) if sf_val > se => (pe, sf_val),
                _ => (pe, se),
            }
        }
        Domain::DumpedAheadOfPlan => {
            match sf {
                Some(sf_val) if sf_val > se => (pe.min(sf_val), se),
                _ => (pe, se),
            }
        }
        _ => (0.0, 0.0),
    }
}
