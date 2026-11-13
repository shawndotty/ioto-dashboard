import { t } from "../../../lang/helpers";

export const SVG_NS = "http://www.w3.org/2000/svg";

export function svgEl<K extends keyof SVGElementTagNameMap>(
	doc: Document,
	tag: K,
	attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
	const el = doc.createElementNS(SVG_NS, tag);
	for (const [key, value] of Object.entries(attrs)) {
		el.setAttribute(key, String(value));
	}
	return el;
}

/** i18n key → display text, tolerant of unknown keys. */
export function label(key: string): string {
	return t(key as Parameters<typeof t>[0]);
}

export function seriesClass(series: number | { colorIndex: number }): string {
	const index = typeof series === "number" ? series : series.colorIndex;
	return `ioto-chart-series-${index}`;
}

export function setHidden(node: Element, hidden: boolean): void {
	node.classList.toggle("ioto-chart-hidden", hidden);
}

export interface ChartDims {
	width: number;
	height: number;
}

export interface TooltipRow {
	label: string;
	value: string;
	/** Color class for the swatch, e.g. `ioto-chart-series-1`. */
	className: string;
}

export function renderTooltipRows(
	tooltip: HTMLElement,
	title: string,
	rows: TooltipRow[],
	clickable: boolean,
): void {
	tooltip.empty();
	tooltip.createDiv({ cls: "ioto-chart-tooltip-date", text: title });
	for (const row of rows) {
		const el = tooltip.createDiv({ cls: "ioto-chart-tooltip-row" });
		el.createSpan({
			cls: `ioto-chart-tooltip-swatch ${row.className}`,
		});
		el.createSpan({ cls: "ioto-chart-tooltip-name", text: row.label });
		el.createSpan({ cls: "ioto-chart-tooltip-value", text: row.value });
	}
	if (clickable) {
		tooltip.createDiv({
			cls: "ioto-chart-tooltip-hint",
			text: label("CHART_TOOLTIP_CLICK_HINT"),
		});
	}
}

/** Places the tooltip above `anchor` in viewBox units, clamped to `el`. */
export function positionTooltip(
	el: HTMLElement,
	svg: SVGElement,
	dims: ChartDims,
	anchorX: number,
	anchorY: number,
	tooltip: HTMLElement,
): void {
	const svgRect = svg.getBoundingClientRect();
	const rootRect = el.getBoundingClientRect();
	const scaleX = svgRect.width > 0 ? svgRect.width / dims.width : 1;
	const scaleY = svgRect.height > 0 ? svgRect.height / dims.height : 1;
	const localX = svgRect.left - rootRect.left + anchorX * scaleX;
	const localY = svgRect.top - rootRect.top + anchorY * scaleY;
	const width = tooltip.offsetWidth;
	const height = tooltip.offsetHeight;
	const maxLeft = Math.max(2, rootRect.width - width - 2);
	tooltip.style.left = `${Math.round(
		Math.max(2, Math.min(maxLeft, localX - width / 2)),
	)}px`;
	const above = localY - height - 10;
	tooltip.style.top = `${Math.round(
		above >= 2 ? above : Math.min(localY + 12, rootRect.height - height),
	)}px`;
}

/** Pointer position in viewBox units. */
export function pointerInViewBox(
	svg: SVGElement,
	dims: ChartDims,
	event: { clientX: number; clientY: number },
): { x: number; y: number } {
	const rect = svg.getBoundingClientRect();
	return {
		x: rect.width > 0 ? ((event.clientX - rect.left) * dims.width) / rect.width : 0,
		y:
			rect.height > 0
				? ((event.clientY - rect.top) * dims.height) / rect.height
				: 0,
	};
}
