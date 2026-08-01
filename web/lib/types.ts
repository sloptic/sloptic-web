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
}

export interface GradeResult {
  mode: "passive";
  catalog_version: string;
  passive_probe_count?: number;
  slop_score: number;
  axis_slop: { security: number; qa: number; performance: number };
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
