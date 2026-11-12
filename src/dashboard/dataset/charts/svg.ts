import { t } from "../../../lang/helpers";
import { nearestBandIndex, nearestIndex } from "./geometry";
import type { ChartSeries, ChartSpec } from "./spec";

const SVG_NS = "http://www.w3.org/2000/svg";

export interface ChartInteractions {
	onActivate?(target: { bucketKey: string; seriesKey?: string }): void;
	isEnabled?(): boolean;
}

function svgEl<K extends keyof SVGElementTagNameMap>(
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
function label(key: string): string {
	return t(key as Parameters<typeof t>[0]);
}

function seriesClass(series: ChartSeries): string {
	return `ioto-chart-series-${series.colorIndex}`;
}

function renderAxes(
	svg: SVGElement,
	doc: Document,
	spec: ChartSpec,
): void {
	const { plot } = spec;
	const bottom = plot.top + plot.height;

	if (spec.y.grid) {
		for (const tick of spec.y.ticks) {
			svg.appendChild(
				svgEl(doc, "line", {
					x1: plot.left,
					y1: tick.position,
					x2: plot.left + plot.width,
					y2: tick.position,
					class: "ioto-chart-grid",
				}),
			);
		}
	}

	svg.appendChild(
		svgEl(doc, "line", {
			x1: plot.left,
			y1: plot.top,
			x2: plot.left,
			y2: bottom,
			class: "ioto-chart-axis-line",
		}),
	);
	svg.appendChild(
		svgEl(doc, "line", {
			x1: plot.left,
			y1: bottom,
			x2: plot.left + plot.width,
			y2: bottom,
			class: "ioto-chart-axis-line",
		}),
	);

	if (spec.y.showLabels) {
		for (const tick of spec.y.ticks) {
			const text = svgEl(doc, "text", {
				x: plot.left - 6,
				y: tick.position,
				dy: "0.32em",
				"text-anchor": "end",
				class: "ioto-chart-tick",
			});
			text.textContent = tick.label;
			if (tick.fullLabel && tick.fullLabel !== tick.label) {
				const title = svgEl(doc, "title");
				title.textContent = tick.fullLabel;
				text.appendChild(title);
			}
			svg.appendChild(text);
		}
	}

	if (spec.x.showLabels) {
		const labelY = bottom + 12;
		for (const tick of spec.x.ticks) {
			const text = svgEl(doc, "text", {
				x: tick.position,
				y: labelY,
				"text-anchor":
					tick.anchor ?? (spec.xRotate === 0 ? "middle" : "end"),
				class: "ioto-chart-label",
			});
			if (spec.xRotate !== 0) {
				text.setAttribute(
					"transform",
					`rotate(-${spec.xRotate} ${tick.position} ${labelY})`,
				);
			}
			text.textContent = tick.label;
			if (tick.fullLabel && tick.fullLabel !== tick.label) {
				const title = svgEl(doc, "title");
				title.textContent = tick.fullLabel;
				text.appendChild(title);
			}
			svg.appendChild(text);
		}
	}

	if (spec.y.title) {
		const text = svgEl(doc, "text", {
			x: 10,
			y: plot.top + plot.height / 2,
			"text-anchor": "middle",
			class: "ioto-chart-axis-title",
			transform: `rotate(-90 10 ${plot.top + plot.height / 2})`,
		});
		text.textContent = spec.y.title;
		svg.appendChild(text);
	}
	if (spec.x.title) {
		const text = svgEl(doc, "text", {
			x: plot.left + plot.width / 2,
			y: spec.height - 4,
			"text-anchor": "middle",
			class: "ioto-chart-axis-title",
		});
		text.textContent = spec.x.title;
		svg.appendChild(text);
	}
}

function renderLineSeries(
	svg: SVGElement,
	doc: Document,
	spec: ChartSpec,
	nativeTitles: boolean,
): void {
	const showDots = spec.series.every((series) => series.points.length <= 60);
	for (const series of spec.series) {
		if (series.points.length === 0) continue;
		svg.appendChild(
			svgEl(doc, "polyline", {
				points: series.points
					.map((point) => `${point.x},${point.y}`)
					.join(" "),
				class: `ioto-chart-path ${seriesClass(series)}`,
			}),
		);
		if (!showDots) continue;
		for (const point of series.points) {
			const circle = svgEl(doc, "circle", {
				cx: point.x,
				cy: point.y,
				r: 2,
				class: `ioto-chart-dot ${seriesClass(series)}`,
			});
			if (nativeTitles) {
				const title = svgEl(doc, "title");
				title.textContent = `${point.label}: ${spec.y.format(point.value)}`;
				circle.appendChild(title);
			}
			svg.appendChild(circle);
		}
	}
}

function renderBarSeries(
	svg: SVGElement,
	doc: Document,
	spec: ChartSpec,
	nativeTitles: boolean,
): SVGRectElement[] {
	const bars = spec.series[0]?.bars ?? [];
	const bandWidth = bars[0]?.w ?? 0;
	const showValueLabels =
		spec.showValueLabels && bars.length <= 40 && bandWidth >= 28;
	const rects: SVGRectElement[] = [];

	for (const series of spec.series) {
		for (const bar of series.bars ?? []) {
			const rect = svgEl(doc, "rect", {
				x: bar.x,
				y: bar.y,
				width: bar.w,
				height: bar.h,
				rx: bar.h > 3 ? 1 : 0.5,
				class: `ioto-chart-bar-rect ${seriesClass(series)}`,
			});
			if (nativeTitles) {
				const title = svgEl(doc, "title");
				title.textContent = `${bar.label}: ${spec.y.format(bar.value)}`;
				rect.appendChild(title);
			}
			svg.appendChild(rect);
			rects.push(rect);
		}
	}

	if (!showValueLabels) return rects;
	for (const bar of bars) {
		const above = bar.value >= 0;
		const text = svgEl(doc, "text", {
			x: bar.x + bar.w / 2,
			y: above
				? Math.max(spec.plot.top + 9, bar.y - 4)
				: bar.y + bar.h + 11,
			"text-anchor": "middle",
			class: "ioto-chart-value-label",
		});
		text.textContent = spec.y.format(bar.value);
		svg.appendChild(text);
	}
	return rects;
}

function renderLegend(el: HTMLElement, spec: ChartSpec): void {
	if (!spec.showLegend || spec.series.length === 0) return;
	const legend = el.createDiv({ cls: "ioto-chart-legend" });
	const suffix = spec.cumulative
		? ` · ${label("CHART_LEGEND_CUMULATIVE")}`
		: "";
	for (const series of spec.series) {
		const item = legend.createDiv({ cls: "ioto-chart-legend-item" });
		item.createSpan({
			cls: `ioto-chart-legend-swatch ${seriesClass(series)}`,
		});
		item.createSpan({
			cls: "ioto-chart-legend-label",
			text: `${label(series.label)}${suffix}`,
		});
	}
}

function renderValueList(el: HTMLElement, spec: ChartSpec): void {
	if (!spec.valueList || spec.valueList.length === 0) return;
	const list = el.createDiv({ cls: "ioto-chart-values" });
	list.style.maxHeight = `${Math.min(spec.valueList.length, 6) * 20}px`;
	for (const entry of spec.valueList) {
		const item = list.createDiv({ cls: "ioto-chart-value-item" });
		item.createSpan({ cls: "ioto-chart-value-label", text: entry.label });
		item.createSpan({ cls: "ioto-chart-value-text", text: entry.text });
	}
}

interface TooltipRow {
	label: string;
	value: string;
	seriesIndex: number;
}

function renderTooltipRows(
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
			cls: `ioto-chart-tooltip-swatch ioto-chart-series-${row.seriesIndex}`,
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
function positionTooltip(
	el: HTMLElement,
	svg: SVGElement,
	spec: ChartSpec,
	anchorX: number,
	anchorY: number,
	tooltip: HTMLElement,
): void {
	const svgRect = svg.getBoundingClientRect();
	const rootRect = el.getBoundingClientRect();
	const scaleX = svgRect.width > 0 ? svgRect.width / spec.width : 1;
	const scaleY = svgRect.height > 0 ? svgRect.height / spec.height : 1;
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

function appendInteractionLayer(
	el: HTMLElement,
	svg: SVGElement,
	doc: Document,
	spec: ChartSpec,
	interactions: ChartInteractions,
): void {
	const { plot } = spec;
	const bottom = plot.top + plot.height;
	const count = spec.series[0]?.points.length ?? 0;
	if (count === 0) return;

	const hit = svgEl(doc, "rect", {
		x: plot.left,
		y: plot.top,
		width: plot.width,
		height: plot.height,
		class: "ioto-chart-hit",
	});
	hit.setAttribute("fill", "transparent");

	const crosshair = svgEl(doc, "line", {
		x1: plot.left,
		y1: plot.top,
		x2: plot.left,
		y2: bottom,
		class: "ioto-chart-crosshair",
	});
	const setHidden = (node: Element, hidden: boolean): void => {
		node.classList.toggle("ioto-chart-hidden", hidden);
	};
	setHidden(crosshair, true);

	const dots = svgEl(doc, "g", { class: "ioto-chart-hover-dot" });
	const dotEls = spec.series.map((series) => {
		const circle = svgEl(doc, "circle", {
			cx: 0,
			cy: 0,
			r: 3.5,
			class: seriesClass(series),
		});
		setHidden(circle, true);
		dots.appendChild(circle);
		return circle;
	});

	svg.appendChild(hit);
	svg.appendChild(crosshair);
	svg.appendChild(dots);

	const tooltip = el.createDiv({ cls: "ioto-chart-tooltip" });
	setHidden(tooltip, true);

	let activeIndex = -1;
	let lastTouchKey: string | null = null;

	const indexAt = (event: PointerEvent): number => {
		const rect = svg.getBoundingClientRect();
		if (rect.width <= 0) return -1;
		const px = ((event.clientX - rect.left) * spec.width) / rect.width;
		return nearestIndex(px, plot.left, plot.width, count);
	};

	const hide = (): void => {
		activeIndex = -1;
		setHidden(crosshair, true);
		for (const circle of dotEls) setHidden(circle, true);
		setHidden(tooltip, true);
	};

	const showAt = (index: number): void => {
		if (index < 0) return;
		activeIndex = index;
		const x = spec.series[0]?.points[index]?.x ?? plot.left;
		crosshair.setAttribute("x1", String(x));
		crosshair.setAttribute("x2", String(x));
		setHidden(crosshair, false);
		spec.series.forEach((series, seriesIndex) => {
			const circle = dotEls[seriesIndex];
			const point = series.points[index];
			if (!circle) return;
			if (!point) {
				setHidden(circle, true);
				return;
			}
			circle.setAttribute("cx", String(point.x));
			circle.setAttribute("cy", String(point.y));
			setHidden(circle, false);
		});

		const anchorPoint = spec.series[0]?.points[index];
		renderTooltipRows(
			tooltip,
			anchorPoint?.label ?? "",
			spec.series.flatMap((series) => {
				const point = series.points[index];
				if (!point) return [];
				return [
					{
						label: label(series.label),
						value: spec.y.format(point.value),
						seriesIndex: series.colorIndex,
					},
				];
			}),
			typeof interactions.onActivate === "function",
		);
		setHidden(tooltip, false);
		positionTooltip(el, svg, spec, anchorPoint?.x ?? 0, anchorPoint?.y ?? 0, tooltip);
	};

	const activate = (index: number): void => {
		if (index < 0 || !interactions.onActivate) return;
		const point = spec.series[0]?.points[index];
		const bucketKey = point?.bucketKey;
		if (!bucketKey) return;
		interactions.onActivate({ bucketKey, seriesKey: point?.seriesKey });
	};

	hit.addEventListener("pointermove", (event) => {
		if (event.pointerType === "touch") return;
		showAt(indexAt(event));
	});
	hit.addEventListener("pointerdown", (event) => {
		const index = indexAt(event);
		if (event.pointerType !== "touch") return;
		const bucketKey = spec.series[0]?.points[index]?.bucketKey ?? null;
		if (activeIndex !== index) {
			showAt(index);
			lastTouchKey = bucketKey;
			return;
		}
		if (bucketKey && bucketKey === lastTouchKey) {
			activate(index);
			lastTouchKey = null;
		}
	});
	hit.addEventListener("click", (event) => {
		if ((event as PointerEvent).pointerType === "touch") return;
		activate(indexAt(event as PointerEvent));
	});
	hit.addEventListener("pointerleave", hide);
	hit.addEventListener("pointercancel", hide);
}

function appendBarInteractionLayer(
	el: HTMLElement,
	svg: SVGElement,
	doc: Document,
	spec: ChartSpec,
	interactions: ChartInteractions,
	rects: SVGRectElement[],
): void {
	const series = spec.series[0];
	const bars = series?.bars ?? [];
	const { plot } = spec;
	if (!series || bars.length === 0) return;

	const hit = svgEl(doc, "rect", {
		x: plot.left,
		y: plot.top,
		width: plot.width,
		height: plot.height,
		class: "ioto-chart-hit",
	});
	hit.setAttribute("fill", "transparent");
	svg.appendChild(hit);

	const tooltip = el.createDiv({ cls: "ioto-chart-tooltip ioto-chart-hidden" });

	let activeIndex = -1;
	let lastTouchKey: string | null = null;

	const setActive = (index: number): void => {
		if (activeIndex >= 0) rects[activeIndex]?.classList.remove("is-active");
		activeIndex = index;
		if (index >= 0) rects[index]?.classList.add("is-active");
	};
	const hide = (): void => {
		setActive(-1);
		tooltip.classList.add("ioto-chart-hidden");
	};
	const indexAt = (event: PointerEvent): number => {
		const bounds = svg.getBoundingClientRect();
		if (bounds.width <= 0) return -1;
		const px = ((event.clientX - bounds.left) * spec.width) / bounds.width;
		return nearestBandIndex(px, plot.left, plot.width, bars.length);
	};
	const showAt = (index: number): void => {
		const bar = bars[index];
		if (!bar) return;
		setActive(index);
		renderTooltipRows(
			tooltip,
			bar.label,
			[
				{
					label: label(series.label),
					value: spec.y.format(bar.value),
					seriesIndex: series.colorIndex,
				},
			],
			typeof interactions.onActivate === "function",
		);
		tooltip.classList.remove("ioto-chart-hidden");
		positionTooltip(
			el,
			svg,
			spec,
			bar.x + bar.w / 2,
			Math.max(plot.top, bar.y),
			tooltip,
		);
	};
	const activate = (index: number): void => {
		const bar = bars[index];
		if (!bar?.bucketKey || !interactions.onActivate) return;
		interactions.onActivate({
			bucketKey: bar.bucketKey,
			seriesKey: bar.seriesKey,
		});
	};

	hit.addEventListener("pointermove", (event) => {
		if (event.pointerType === "touch") return;
		showAt(indexAt(event));
	});
	hit.addEventListener("pointerdown", (event) => {
		if (event.pointerType !== "touch") return;
		const index = indexAt(event);
		const bucketKey = bars[index]?.bucketKey ?? null;
		if (activeIndex !== index) {
			showAt(index);
			lastTouchKey = bucketKey;
			return;
		}
		if (bucketKey && bucketKey === lastTouchKey) {
			activate(index);
			lastTouchKey = null;
		}
	});
	hit.addEventListener("click", (event) => {
		if ((event as PointerEvent).pointerType === "touch") return;
		activate(indexAt(event as PointerEvent));
	});
	hit.addEventListener("pointerleave", hide);
	hit.addEventListener("pointercancel", hide);
}

export function renderChart(
	el: HTMLElement,
	spec: ChartSpec,
	interactions?: ChartInteractions,
): void {
	const doc = el.ownerDocument;
	const interactive =
		Boolean(spec.interactive) && interactions?.isEnabled?.() !== false;
	const svg = svgEl(doc, "svg", {
		viewBox: `0 0 ${spec.width} ${spec.height}`,
		width: "100%",
		height: spec.height,
		role: "img",
		"aria-label": label(spec.ariaKey),
		class: `ioto-chart ioto-chart-${spec.kind}`,
	});
	const summary = svgEl(doc, "title");
	summary.textContent = label(spec.ariaKey);
	svg.appendChild(summary);

	renderAxes(svg, doc, spec);
	if (spec.kind === "line") {
		renderLineSeries(svg, doc, spec, !interactive);
		if (interactive && interactions) {
			appendInteractionLayer(el, svg, doc, spec, interactions);
		}
	} else {
		const rects = renderBarSeries(svg, doc, spec, !interactive);
		if (interactive && interactions) {
			appendBarInteractionLayer(el, svg, doc, spec, interactions, rects);
		}
	}
	el.appendChild(svg);

	renderLegend(el, spec);
	renderValueList(el, spec);

	if (spec.hiddenCount > 0) {
		el.createDiv({
			cls: "ioto-chart-more",
			text: t("SETTING_AXIS_MORE_ITEMS", [String(spec.hiddenCount)]),
		});
	}
}
