import type { Area } from "./checks.generated";
// Shapes shared across the API and UI. Mirrors shared/contract.md.

export type GradeStatus = "queued" | "running" | "done" | "failed" | "cancelled";

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
  /** Set by the report API when this finding's evidence was withheld from a viewer who is not a verified
   *  owner of the app (lib/evidence.ts). Its reason, target and evidence are then absent on purpose. */
  withheld?: boolean;
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
  /** The battery that ran. "passive" is the passive floor any URL gets (45 checks since 3.0); "active" is the full
   *  battery, which needs a verified origin or a verified event. Widened from the passive-only
   *  literal now that the UI has to name which measurement a percentile came from: the two rank on
   *  different frozen curves and must never be presented as the same number. */
  mode: "passive" | "active";
  catalog_version: string;
  passive_probe_count?: number;
  slop_score: number;
  /** Only the axes that scored. A clean axis is absent, not zero: the first real grade
   *  returned { qa, security } with no performance key. */
  // Partial: the grader OMITS an axis with nothing wrong rather than zeroing it, and a 2.x grade has
  // no accessibility key at all, since that axis did not exist until 3.0.
  axis_slop: Partial<Record<Area, number>>;
  coverage: Coverage;
  platform?: Record<string, unknown> | null;
  surface?: Record<string, unknown> | null;
  findings: Finding[];
  /** Placement on the frozen PASSIVE floor curve. Null when no curve is configured or the grade
   *  could not be ranked; a missing percentile is an honest absence, never a zero. */
  percentile?: number | null;
  percentile_band?: string | null;
  curve_version?: string | null;
  /** The ruler the grader stamped at grade time: {full, passive} curve versions. NULL or absent for any
   *  grade from before Sloptic 3.0, which must render as "ruler unspecified", never as current; a 3.0
   *  score does not compare to a 2.x one. It is also what tells the report which AXES the grade was
   *  scored on, since accessibility only became its own axis at 3.0. */
  ruler?: { full?: string; passive?: string } | null;
  ranking?: {
    percentile?: number;
    band?: string;
    cleaner_than_pct?: number;
    reference?: string;
    absolute_gates?: string[];
    axes?: Record<string, { applicable: boolean; percentile?: number; band?: string }>;
    /** The tiebreak inputs, so a placement can show what separated it from an equal score. */
    slop_potential?: number;
    categories_applied?: number;
    defended?: number;
    /** Set by the worker from the grader's own gate predicate; absent on grades from before it. */
    has_catastrophe?: boolean;
    /** The grader's own account of how much it could see: coverage, clean rate, untested families. */
    reporting?: Record<string, unknown>;
  } | null;
  /** sloptic.reportcard.build_card(): per finding, what was expected, what was seen, what it means,
   *  and the remediation. The thing a reader actually wants after a grade. */
  card?: ReportCard | null;
  /** Every outcome, not just failures, with the evidence each recorded. Lets a passing check show
   *  what it measured. Fans out per target, so there are more of these than there are checks. */
  outcomes?: Outcome[] | null;
  /** Per axis, the damped score this app would carry if every applicable check had fired. Always
   *  >= axis_slop, so actual/potential says how much of its own failure surface the app avoided. */
  axis_potential?: Partial<Record<Area, number>> | null;
  /** Probes a bot challenge stopped from running. With an empty coverage it means the whole battery
   *  was blocked and the grade was withheld; a subset means a mid-grade challenge truncated the tail
   *  (which retry_blocked then recovers). */
  blocked_probes?: string[] | null;
  /** Axes left incomplete by a challenge, so a clean axis reading is not mistaken for a full one. */
  incomplete_axes?: string[] | null;
  /** True when a WAF / bot challenge fired during the grade. */
  bot_challenge?: boolean | null;
  /** The blocked-probe count when the first recovery pass ran, so partial recovery can be shown as
   *  "recovered P of M". null before any pass. blocked_probes holds only what is still blocked. */
  retry_blocked_initial?: number | null;
  /** "entry" = the first fetch was challenged, nothing graded, the score is not a measurement. A
   *  later value = some probes ran before the block. Empty/absent when no challenge fired. */
  challenge_stage?: string | null;
  /** Checks that completed before a bot challenge tripped, so a withheld grade can say how far it
   *  got. null when no challenge, or a first-fetch challenge with nothing to attribute. */
  challenge_onset_index?: number | null;
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
  /** The score priced over the probes that have finished so far. A floor in motion: pending checks
   *  can only add, so it never reads as a verdict while the grade runs. */
  slop_preview?: number;
  /** What the worker called it before slop_preview. Read as a fallback so a grade already running
   *  during a deploy keeps showing its score. Remove once no such grade can still be in flight. */
  preview?: number;
}

export interface GradeView {
  id: string;
  status: GradeStatus;
  /** Exactly what was submitted, path and query included. */
  url: string;
  /** Scheme, host and port: the scope the grade actually covered. */
  origin?: string;
  /** Which battery was asked for. Known from the moment it is queued, unlike result.mode, so a grade
   *  in progress can place itself against the right curve. */
  mode?: "passive" | "active";
  submitted_at: string;
  /** When the worker claimed the grade. Differs from submitted_at by the queue wait, which for
   *  event grades can include long pauses; the running timer starts here, not at submission. */
  claimed_at?: string | null;
  error: string | null;
  result: GradeResult | null;
  /** Present only while queued, so the UI can explain the wait instead of spinning. */
  queue?: QueueInfo;
  /** Present only while running. */
  progress?: GradeProgress | null;
  /** Whether an account owns this grade. Absent (not false) when the server cannot tell. */
  claimed?: boolean;
  /** Whether the viewer is the account that saved it. `claimed` says only that someone did. */
  mine?: boolean;
  /** Whether this viewer holds a live grant for the graded origin, so the full battery is available
   *  to them. Present only on a finished passive grade, where it could change anything. */
  can_grade_actively?: boolean;
  /** True when this response withheld where a secret, backend or exposed file lives, because the viewer
   *  is not a verified owner of the app (see lib/evidence.ts). The page says so rather than showing a
   *  finding with nothing under it. */
  evidence_withheld?: boolean;
  /** When the report is deleted, or null once an account keeps it. */
  expires_at?: string | null;
  retain_days?: number;
  /** When the WAF-blocked probe tail is due for another pass, null when none is pending (either
   *  nothing was blocked, the tail was recovered, or the passes ran out). */
  retry_due_at?: string | null;
  /** How many recovery passes have already run. */
  retry_passes?: number;
  /** The event run that queued this grade, when an event did. Null for a grade submitted here. */
  event?: { slug: string; runId: string; paused: boolean; canResume: boolean } | null;
}
