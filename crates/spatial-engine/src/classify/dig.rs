use super::{Domain, Interval};

// ---------------------------------------------------------------------------
// Dig-mode per-cell / per-vertex classification
// ---------------------------------------------------------------------------

pub(super) fn classify_cell_dig(
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
            domain: Domain::PrescheduleDelay,
            upper: ps,
            lower: ss,
        });
    }

    if ps < ss - eps {
        out.push(Interval {
            domain: Domain::MinedBeforeStart,
            upper: ss,
            lower: ps,
        });
    }

    let pam_upper = ps.min(ss);
    let pam_lower = pe.max(se);
    if pam_upper > pam_lower + eps {
        out.push(Interval {
            domain: Domain::PlannedAndMined,
            upper: pam_upper,
            lower: pam_lower,
        });
    }

    if pe > se + eps {
        let pnm_upper = pe.min(ps.min(ss));
        let pnm_lower = se;
        if pnm_upper > pnm_lower + eps {
            out.push(Interval {
                domain: Domain::PlannedNotMined,
                upper: pnm_upper,
                lower: pnm_lower,
            });
        }
    }

    if pe < se - eps {
        match sf {
            Some(sf_val) if sf_val < se => {
                let aop_lower = pe.max(sf_val);
                if se > aop_lower + eps {
                    out.push(Interval {
                        domain: Domain::AheadOfPlan,
                        upper: se,
                        lower: aop_lower,
                    });
                }
                if pe < sf_val - eps {
                    out.push(Interval {
                        domain: Domain::MinedNotPlanned,
                        upper: sf_val,
                        lower: pe,
                    });
                }
            }
            _ => {
                out.push(Interval {
                    domain: Domain::MinedNotPlanned,
                    upper: se,
                    lower: pe,
                });
            }
        }
    }

    out
}

pub(super) fn per_vertex_bounds_dig(domain: Domain, ps: f64, pe: f64, ss: f64, se: f64, sf: Option<f64>) -> (f64, f64) {
    match domain {
        Domain::PrescheduleDelay => (ps, ss),
        Domain::MinedBeforeStart => (ss, ps),
        Domain::PlannedAndMined => (ps.min(ss), pe.max(se)),
        Domain::PlannedNotMined => (pe.min(ps.min(ss)), se),
        Domain::MinedNotPlanned => {
            match sf {
                Some(sf_val) if sf_val < se => (sf_val, pe),
                _ => (se, pe),
            }
        }
        Domain::AheadOfPlan => {
            match sf {
                Some(sf_val) if sf_val < se => (se, pe.max(sf_val)),
                _ => (se, pe),
            }
        }
        _ => (0.0, 0.0),
    }
}
