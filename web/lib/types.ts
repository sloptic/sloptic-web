// Shapes shared across the API and UI. Mirrors shared/contract.md.

export type GradeStatus = "queued" | "running" | "done" | "failed";

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
}

export interface GradeView {
  id: string;
  status: GradeStatus;
  url: string;
  submitted_at: string;
  error: string | null;
  result: GradeResult | null;
}
