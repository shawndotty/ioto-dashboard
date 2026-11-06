/**
 * Reserved shape for the metric layer (F2). No algorithm is implemented in
 * this round; components must not compute ratios themselves.
 */
export interface ProjectProgressMetric {
	project: string;
	total: number;
	completed: number;
	open: number;
	cancelled: number;
	other: number;
	ratio: number; // completed / total, 0..1
	computedAt: number; // epoch ms
}
