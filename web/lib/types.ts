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
  /** What this fault is worth ON ITS OWN, before any damper. Prices, not addends: a list of these
   *  does not sum to the score, which is the bug that made `contribution` necessary. */
  penalty: number;
  /** What this finding actually ADDED to the score, after its variant group collapsed and its
   *  category decayed. Rounded by largest remainder in the grader, so the column sums to slop_score
   *  exactly as emitted. OPTIONAL because records written before sloptic 2.2.0 have no such key, and
   *  every grade already stored here is one of those. */
  contribution?: number;
  /** Probes sharing one of these are the same logical flaw found different ways; only the dearest is
   *  priced. Needed to tell "already counted elsewhere" apart from "decayed to nothing", which look
   *  identical at 0.0 and mean different things to a reader. */
  variant_group_id?: string | null;
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
  /** The battery that ran. "passive" is the 44-check floor any URL gets; "active" is the full
   *  battery, which needs a verified origin or a verified event. Widened from the passive-only
   *  literal now that the UI has to name which measurement a percentile came from: the two rank on
   *  different frozen curves and must never be presented as the same number. */
  mode: "passive" | "active";
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
  /** Placement on the frozen PASSIVE floor curve. Null when no curve is configured or the grade
   *  could not be ranked; a missing percentile is an honest absence, never a zero. */
  percentile?: number | null;
  percentile_band?: string | null;
  curve_version?: string | null;
  ranking?: {
    percentile?: number;
    band?: string;
    cleaner_than_pct?: number;
    reference?: string;
    absolute_gates?: string[];
    axes?: Record<string, { applicable: boolean; percentile?: number; band?: string }>;
  } | null;
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

/** Live progress of a running grade, straight from the grader's own callbacks. Display only. */
export interface GradeProgress {
  phase?: string;
  label?: string;
  done?: number;
  total?: number;
  probe?: string;
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
  /** Present only while running. */
  progress?: GradeProgress | null;
  /** Whether an account owns this grade. Absent (not false) when the server cannot tell. */
  claimed?: boolean;
  /** When the report is deleted, or null once an account keeps it. */
  expires_at?: string | null;
  retain_days?: number;
}
