import { t } from "../../../lang/helpers";
import type { ChartSeries, ChartSpec } from "./spec";

const SVG_NS = "http://www.w3.org/2000/svg";

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
				"text-anchor": spec.xRotate === 0 ? "middle" : "end",
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
			const title = svgEl(doc, "title");
			title.textContent = `${point.label}: ${spec.y.format(point.value)}`;
			circle.appendChild(title);
			svg.appendChild(circle);
		}
	}
}

function renderBarSeries(
	svg: SVGElement,
	doc: Document,
	spec: ChartSpec,
): void {
	const bars = spec.series[0]?.bars ?? [];
	const bandWidth = bars[0]?.w ?? 0;
	const showValueLabels =
		spec.showValueLabels && bars.length <= 40 && bandWidth >= 28;

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
			const title = svgEl(doc, "title");
			title.textContent = `${bar.label}: ${spec.y.format(bar.value)}`;
			rect.appendChild(title);
			svg.appendChild(rect);
		}
	}

	if (!showValueLabels) return;
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

export function renderChart(el: HTMLElement, spec: ChartSpec): void {
	const doc = el.ownerDocument;
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
		renderLineSeries(svg, doc, spec);
	} else {
		renderBarSeries(svg, doc, spec);
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
