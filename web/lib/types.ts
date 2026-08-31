// Shapes shared across the API and UI. Mirrors shared/contract.md.

export type GradeStatus = "queued" | "running" | "done" | "failed";

/** Why a queued grade is waiting. Absent unless it is actually waiting on something.
 *  `stalled` means no worker has checked in recently, i.e. nothing is running at all. */
export interface QueueInfo {
  worker_alive: boolean;
  stalled: boolean;
  /** Grades queued ahead of this one. 0 means this is next. */
  ahead: number;
  /** Seconds this grade has been queued. */
  waiting_seconds: number;
}

export interface Finding {
  probe_id: string;
  bundle: string;
  category: string;
  penalty: number;
  group?: string;
  reason?: string;
  target?: string;
  evidence?: Record<string, unknown>;
}

export interface Coverage {
  probes_total?: number;
  probes_applicable?: number;
  probes_na?: number;
  pct_applicable?: number;
  ran_kinds?: string[];
  na_kinds?: string[];
  /** Probe ids that applied, whether they fired or came back clean. What PASSED is this minus the
   *  findings, which is the only way to name a check that did not fail. */
  applied?: string[];
  /** Why a whole kind could not run, keyed by kind. */
  na_reasons?: Record<string, string>;
  na_reasons_by_probe?: Record<string, string>;
  by_kind?: Record<string, unknown>;
}

export interface GradeResult {
  mode: "passive";
  catalog_version: string;
  passive_probe_count?: number;
  slop_score: number;
  /** Only the axes that scored. A clean axis is absent, not zero: the first real grade
   *  returned { qa, security } with no performance key. */
  axis_slop: Partial<Record<"security" | "qa" | "performance", number>>;
  coverage: Coverage;
  platform?: Record<string, unknown> | null;
  surface?: Record<string, unknown> | null;
  findings: Finding[];
  /** sloptic.reportcard.build_card(): per finding, what was expected, what was seen, what it means,
   *  and the remediation. The thing a reader actually wants after a grade. */
  card?: ReportCard | null;
  /** Every outcome, not just failures, with the evidence each recorded. Lets a passing check show
   *  what it measured. Fans out per target, so there are more of these than there are checks. */
  outcomes?: Outcome[] | null;
  /** Per axis, the damped score this app would carry if every applicable check had fired. Always
   *  >= axis_slop, so actual/potential says how much of its own failure surface the app avoided. */
  axis_potential?: Partial<Record<"security" | "qa" | "performance", number>> | null;
}

export interface Outcome {
  probe_id: string;
  bundle: string;
  category: string;
  outcome: "slop_detected" | "clean" | "not_applicable";
  penalty: number;
  target?: string;
  reason?: string;
  evidence?: Record<string, unknown>;
}

export interface CardEntry {
  probe_id: string;
  title: string;
  penalty: number;
  expected: string;
  actual: string;
  indicates: string;
  remediation: string;
}

export interface ReportCard {
  url?: string;
  dnf?: boolean;
  slop_score?: number | null;
  sections?: { axis: string; title: string; penalty: number; entries: CardEntry[] }[];
  /** categories that ran and did not fire */
  passed?: string[];
  /** private-pool findings stay an opaque count unless the viewer is the organizer */
  hidden?: { count: number; penalty: number; entries?: CardEntry[] };
  cov?: Coverage;
}

export interface GradeView {
  id: string;
  status: GradeStatus;
  url: string;
  submitted_at: string;
  error: string | null;
  result: GradeResult | null;
  /** Present only while queued, so the UI can explain the wait instead of spinning. */
  queue?: QueueInfo;
}
