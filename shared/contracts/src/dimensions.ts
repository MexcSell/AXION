/**
 * Improvement cycle 46: the six dimensions of organizational intelligence (spec §16.1), as a read model.
 * Hard rule (spec §16.1, §11 invariant 9): NO composite. A dimension is only a labelled list of independent cells; there is
 * no per-dimension total, no overall number, no score field anywhere in this response. Each cell is one indicator with its
 * own value, sample size n, window, evidence sentence and trend. A cell with n below its own minimum has value null and
 * state 'none'; its evidence then starts with "not enough evidence (n = k)".
 */
export const DIMENSION_KEYS = ['cognitive', 'capability', 'environmental', 'collective', 'knowledge', 'evolutionary'] as const;
export type DimensionKey = (typeof DIMENSION_KEYS)[number];
export const DIMENSION_LABEL: Record<DimensionKey, string> = {
  cognitive: 'Cognitive', capability: 'Capability', environmental: 'Environmental', collective: 'Collective', knowledge: 'Knowledge', evolutionary: 'Evolutionary',
};
export type DimensionWindow = '7d' | '30d' | '90d';
export const DIMENSION_WINDOWS: readonly DimensionWindow[] = ['7d', '30d', '90d'];

export interface DimensionCell {
  /** stable id, 'dimension.indicator' */
  key: string;
  label: string;
  /** null when n is below `minN` (state 'none'); rates are percentages 0..100 */
  value: number | null;
  unit: '%' | 'h' | 'count';
  /** the sample size behind the value; null when the cell is 'hidden' or 'unmeasured' (n is not 0 there, it is unknown to this reader) */
  n: number | null;
  /** the smallest n that yields a value (3, or 5 for task outcomes as in agent reliability) */
  minN: number;
  /** how the cell is measured over time: 'window' = events inside [from, to]; 'snapshot' = state as of `to` */
  basis: 'window' | 'snapshot' | 'none';
  from: string | null;
  to: string | null;
  /** one sentence naming the evidence; for state 'none' it starts with "not enough evidence (n = k)" */
  evidence: string;
  /** which rows the cell reads: 'missions' = missions you can see (simulated and DEMO excluded); 'company' = recorded company-wide, no per-mission visibility */
  scope: 'missions' | 'company';
  /**
   * ok = a value; none = measured but n is below minN; hidden = exists, but not for this reader's role (evidence starts "hidden for your role");
   * unmeasured = no source exists yet (evidence starts "not measured"). hidden and unmeasured always have value null, n null, trend null.
   */
  state: 'ok' | 'none' | 'hidden' | 'unmeasured';
  /** the same cell over the previous equal window (or snapshot date); value null when that side lacks evidence */
  previous: { value: number | null; n: number };
  /** 'up' | 'down' | 'flat' only when both sides have a value; otherwise null */
  trend: 'up' | 'down' | 'flat' | null;
}
export interface DimensionRowDto { key: DimensionKey; label: string; cells: DimensionCell[] }
export interface CompanyDimensionsDto {
  window: DimensionWindow;
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  /** null = the whole company; otherwise a department name */
  department: string | null;
  /** the departments that can be chosen */
  departments: string[];
  dimensions: DimensionRowDto[];
}
