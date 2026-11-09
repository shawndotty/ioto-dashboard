import { clampSize } from "./registry";
import type { DashboardComponentConfig } from "./types";

export interface CardRect {
	id: string;
	top: number;
	left: number;
	width: number;
	height: number;
}

export interface GridMetrics {
	/** Width of a single column in px. */
	columnWidth: number;
	/** `columnWidth` + gap. */
	stepX: number;
	/** Row height + gap. */
	stepY: number;
	/** Gap between columns/rows in px. */
	gap: number;
}

/**
 * Resolves the insertion index for a pointer position. Rects are expected in
 * DOM order; the dragged card is ignored but its slot is kept open so the
 * returned index can be used directly against the filtered list.
 */
export function dropIndex(
	rects: readonly CardRect[],
	x: number,
	y: number,
	draggedId: string,
): number {
	const entries: Array<{ rect: CardRect; index: number }> = [];
	let index = 0;
	for (const rect of rects) {
		if (rect.id === draggedId) continue;
		entries.push({ rect, index });
		index += 1;
	}
	if (entries.length === 0) return 0;
	const ordered = [...entries].sort((a, b) =>
		a.rect.top === b.rect.top
			? a.rect.left - b.rect.left
			: a.rect.top - b.rect.top,
	);
	for (const entry of ordered) {
		const { top, left, width, height } = entry.rect;
		if (y < top) return entry.index;
		if (y < top + height && x < left + width / 2) return entry.index;
	}
	return entries.length;
}

/** Moves one entry; returns a new array, never mutates the input. */
export function moveItem<T>(
	list: readonly T[],
	from: number,
	to: number,
): T[] {
	const result = [...list];
	if (result.length === 0) return result;
	const clampedFrom = Math.min(
		result.length - 1,
		Math.max(0, Math.trunc(from)),
	);
	const clampedTo = Math.min(result.length - 1, Math.max(0, Math.trunc(to)));
	if (clampedFrom === clampedTo) return result;
	const [moved] = result.splice(clampedFrom, 1);
	if (moved === undefined) return result;
	result.splice(clampedTo, 0, moved);
	return result;
}

export function moveById(
	list: readonly DashboardComponentConfig[],
	id: string,
	toIndex: number,
): DashboardComponentConfig[] {
	const from = list.findIndex((item) => item.id === id);
	if (from < 0) return [...list];
	return moveItem(list, from, toIndex);
}

export function stepSize(
	w: number | undefined,
	h: number | undefined,
	axis: "w" | "h",
	direction: -1 | 1,
): { w: number; h: number } {
	const current = clampSize(w, h);
	if (axis === "w") return clampSize(current.w + direction, current.h);
	return clampSize(current.w, current.h + direction);
}

export function resizeByDelta(
	w: number | undefined,
	h: number | undefined,
	dx: number,
	dy: number,
	metrics: GridMetrics,
): { w: number; h: number; dw: number; dh: number } {
	const current = clampSize(w, h);
	const stepX = metrics.stepX > 0 ? metrics.stepX : 1;
	const stepY = metrics.stepY > 0 ? metrics.stepY : 1;
	const dw = Math.round(dx / stepX);
	const dh = Math.round(dy / stepY);
	const next = clampSize(current.w + dw, current.h + dh);
	return { w: next.w, h: next.h, dw, dh };
}

/**
 * Pixel size → snapped whole-cell size. `gap` takes part in the conversion so a
 * card spanning `n` columns is `n * columnWidth + (n - 1) * gap` wide.
 * Invalid input falls back to the smallest allowed size.
 */
export function snapSize(
	pxWidth: number,
	pxHeight: number,
	metrics: GridMetrics,
): { w: number; h: number } {
	const gap = Number.isFinite(metrics.gap) ? Math.max(0, metrics.gap) : 0;
	const stepX = metrics.stepX > 0 ? metrics.stepX : 1;
	const stepY = metrics.stepY > 0 ? metrics.stepY : 1;
	const width = Number.isFinite(pxWidth) ? Math.max(0, pxWidth) : 0;
	const height = Number.isFinite(pxHeight) ? Math.max(0, pxHeight) : 0;
	return clampSize(
		Math.round((width + gap) / stepX),
		Math.round((height + gap) / stepY),
	);
}

export function gridMetrics(
	gridWidth: number,
	columns: number,
	gap: number,
	rowHeight: number,
): GridMetrics {
	const safeColumns = Number.isFinite(columns)
		? Math.max(1, Math.floor(columns))
		: 1;
	const safeGap = Number.isFinite(gap) ? Math.max(0, gap) : 0;
	const safeRowHeight = Number.isFinite(rowHeight)
		? Math.max(1, rowHeight)
		: 1;
	const width = Number.isFinite(gridWidth) ? Math.max(0, gridWidth) : 0;
	const usable = Math.max(0, width - (safeColumns - 1) * safeGap);
	const columnWidth = Math.max(1, usable / safeColumns);
	return {
		columnWidth,
		stepX: columnWidth + safeGap,
		stepY: safeRowHeight + safeGap,
		gap: safeGap,
	};
}
