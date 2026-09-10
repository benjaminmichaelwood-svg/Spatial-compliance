use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Domain enum — the 12 conformance reporting domains (6 dig-mode, 6 dump-mode)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Domain {
    PlannedAndMined,
    PlannedNotMined,
    MinedNotPlanned,
    MinedBeforeStart,
    PrescheduleDelay,
    AheadOfPlan,

    PlannedAndDumped,
    PlannedNotDumped,
    DumpedNotPlanned,
    DumpedBeforeStart,
    DumpPrescheduleDelay,
    DumpedAheadOfPlan,
}

impl Domain {
    pub fn index(self) -> u8 {
        match self {
            Domain::PlannedAndMined => 1,
            Domain::PlannedNotMined => 2,
            Domain::MinedNotPlanned => 3,
            Domain::MinedBeforeStart => 4,
            Domain::PrescheduleDelay => 5,
            Domain::AheadOfPlan => 6,
            Domain::PlannedAndDumped => 7,
            Domain::PlannedNotDumped => 8,
            Domain::DumpedNotPlanned => 9,
            Domain::DumpedBeforeStart => 10,
            Domain::DumpPrescheduleDelay => 11,
            Domain::DumpedAheadOfPlan => 12,
        }
    }

    pub fn color(self) -> &'static str {
        match self {
            Domain::PlannedAndMined => "#4CAF50",
            Domain::PlannedNotMined => "#FFEB3B",
            Domain::MinedNotPlanned => "#F44336",
            Domain::MinedBeforeStart => "#9C27B0",
            Domain::PrescheduleDelay => "#FF9800",
            Domain::AheadOfPlan => "#2196F3",

            Domain::PlannedAndDumped => "#66BB6A",
            Domain::PlannedNotDumped => "#FFF176",
            Domain::DumpedNotPlanned => "#EF5350",
            Domain::DumpedBeforeStart => "#AB47BC",
            Domain::DumpPrescheduleDelay => "#FFA726",
            Domain::DumpedAheadOfPlan => "#42A5F5",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Domain::PlannedAndMined => "Planned and Mined",
            Domain::PlannedNotMined => "Planned Not Mined",
            Domain::MinedNotPlanned => "Mined Not Planned",
            Domain::MinedBeforeStart => "Mined Before Start",
            Domain::PrescheduleDelay => "Preschedule Delay",
            Domain::AheadOfPlan => "Ahead of Plan",

            Domain::PlannedAndDumped => "Planned and Dumped",
            Domain::PlannedNotDumped => "Planned Not Dumped",
            Domain::DumpedNotPlanned => "Dumped Not Planned",
            Domain::DumpedBeforeStart => "Dumped Before Start",
            Domain::DumpPrescheduleDelay => "Dump Preschedule Delay",
            Domain::DumpedAheadOfPlan => "Dumped Ahead of Plan",
        }
    }
}
