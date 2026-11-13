export interface ContainerChildSize {
	w?: number;
	h?: number;
}

export interface ContainerGeometry {
	/** 容器自身网格行数（config.h 钳制后）。 */
	cardRows: number;
	/** 页面网格行高（page.rowHeight，默认 72）。 */
	pageRowHeight: number;
	/** 页面网格行间距（计算样式，回落 12）。 */
	pageGap: number;
	/** 标题栏占位高度；标题隐藏（浮层）时为 0。 */
	headerHeight: number;
	/** 容器内边距。 */
	padding: number;
	/** 容器边框宽度。 */
	borderWidth: number;
	/** 容器内部行间距。 */
	gap: number;
	/** 子项布局行带数。 */
	rows: number;
	/** 用户配置的内部行高。 */
	configuredRowHeight: number;
}

/** 内部行高保底值，与自适应算法一致。 */
export const CONTAINER_ROW_FLOOR = 32;

/** 卡片标题栏高度常量，对应 styles.css 中非浮层标题栏的 min-height。 */
export const CARD_HEADER_HEIGHT = 42;

const MAX_ROWS = 24;

function wholeNumber(value: number | undefined, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.trunc(value);
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

/**
 * 按 CSS grid 默认的 row 优先、稀疏放置语义，算出子项占用的行带数。
 * 返回 0 表示没有子项。
 */
export function gridRowsUsed(
	sizes: readonly ContainerChildSize[],
	columns: number,
): number {
	const cols = Math.max(1, wholeNumber(columns, 1));
	const occupied = new Set<number>();
	let rowCount = 0;
	let cursorRow = 0;
	let cursorCol = 0;

	for (const size of sizes) {
		const w = clamp(wholeNumber(size.w, 1), 1, cols);
		const h = clamp(wholeNumber(size.h, 1), 1, MAX_ROWS);

		for (;;) {
			if (cursorCol + w > cols) {
				cursorRow += 1;
				cursorCol = 0;
			}
			let placedCol = -1;
			for (let column = cursorCol; column + w <= cols; column += 1) {
				if (isFree(occupied, cols, cursorRow, column, w, h)) {
					placedCol = column;
					break;
				}
			}
			if (placedCol >= 0) {
				for (let row = cursorRow; row < cursorRow + h; row += 1) {
					for (let column = placedCol; column < placedCol + w; column += 1) {
						occupied.add(row * cols + column);
					}
				}
				cursorCol = placedCol + w;
				rowCount = Math.max(rowCount, cursorRow + h);
				break;
			}
			cursorRow += 1;
			cursorCol = 0;
		}
	}

	return rowCount;
}

function isFree(
	occupied: ReadonlySet<number>,
	columns: number,
	startRow: number,
	startColumn: number,
	w: number,
	h: number,
): boolean {
	for (let row = startRow; row < startRow + h; row += 1) {
		for (let offset = 0; offset < w; offset += 1) {
			if (occupied.has(row * columns + startColumn + offset)) return false;
		}
	}
	return true;
}

/** 容器正文可用高度（已扣标题栏、内边距、边框）。可为负。 */
export function containerInnerHeight(geo: ContainerGeometry): number {
	const rows = Math.max(1, wholeNumber(geo.cardRows, 1));
	const pageRowHeight = Number.isFinite(geo.pageRowHeight)
		? geo.pageRowHeight
		: 72;
	const pageGap = Number.isFinite(geo.pageGap) ? geo.pageGap : 12;
	return (
		rows * pageRowHeight +
		Math.max(0, rows - 1) * pageGap -
		geo.headerHeight -
		2 * (geo.padding + geo.borderWidth)
	);
}

/**
 * 实际生效的内部行高：不超过可用高度，且不低于 32px 保底。
 * 只缩小不放大，容器够高时与配置值一致。
 */
export function effectiveContainerRowHeight(geo: ContainerGeometry): number {
	const rows = Math.max(1, wholeNumber(geo.rows, 1));
	const inner = containerInnerHeight(geo);
	const fit =
		rows <= 1 ? inner : Math.floor((inner - (rows - 1) * geo.gap) / rows);
	return Math.max(CONTAINER_ROW_FLOOR, Math.min(geo.configuredRowHeight, fit));
}

/**
 * 「适应内容高度」：刚好容纳内容所需的网格行数（未钳制）。
 *
 * 两条判据：
 * - 单行内容优先 1 行容器（只需可用高度 ≥ 保底行高），交由渲染期压缩行高兜底；
 * - 多行内容按配置行高给足，保证不压缩。
 */
export function fitContainerRows(geo: ContainerGeometry): number {
	const rows = Math.max(0, wholeNumber(geo.rows, 0));
	if (rows === 0) return 1;

	const required =
		rows === 1
			? CONTAINER_ROW_FLOOR
			: rows * geo.configuredRowHeight + (rows - 1) * geo.gap;

	for (let h = 1; h <= MAX_ROWS; h += 1) {
		if (containerInnerHeight({ ...geo, cardRows: h }) >= required) return h;
	}
	return MAX_ROWS;
}
