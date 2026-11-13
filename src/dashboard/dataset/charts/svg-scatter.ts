import { t } from "../../../lang/helpers";
import type { ScatterChartSpec, ScatterPoint } from "./scatter-spec";
import type { ChartInteractions } from "./svg";
import {
	label,
	pointerInViewBox,
	positionTooltip,
	renderTooltipRows,
	svgEl,
} from "./svg-base";

const HIT_THRESHOLD = 12;

function renderAxes(
	svg: SVGElement,
	doc: Document,
	spec: ScatterChartSpec,
): void {
	const { plot } = spec;
	const bottom = plot.top + plot.height;

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

	for (const tick of spec.y.ticks) {
		const text = svgEl(doc, "text", {
			x: plot.left - 6,
			y: tick.position,
			dy: "0.32em",
			"text-anchor": "end",
			class: "ioto-chart-tick",
		});
		text.textContent = tick.label;
		svg.appendChild(text);
	}
	for (const tick of spec.x.ticks) {
		const text = svgEl(doc, "text", {
			x: tick.position,
			y: bottom + 12,
			"text-anchor": "middle",
			class: "ioto-chart-label",
		});
		text.textContent = tick.label;
		svg.appendChild(text);
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

function renderPoints(
	svg: SVGElement,
	doc: Document,
	spec: ScatterChartSpec,
): SVGCircleElement[] {
	return spec.points.map((point) => {
		const circle = svgEl(doc, "circle", {
			cx: point.x,
			cy: point.y,
			r: spec.pointRadius,
			class: "ioto-chart-scatter-dot ioto-chart-cat-1",
		});
		svg.appendChild(circle);
		return circle;
	});
}

/** Nearest point whose centre is within the pixel threshold, else -1. */
function nearestPoint(
	points: ScatterPoint[],
	x: number,
	y: number,
): number {
	let best = -1;
	let bestDistance = HIT_THRESHOLD;
	points.forEach((point, index) => {
		const distance = Math.hypot(point.x - x, point.y - y);
		if (distance <= bestDistance) {
			bestDistance = distance;
			best = index;
		}
	});
	return best;
}

function appendInteractionLayer(
	el: HTMLElement,
	svg: SVGElement,
	doc: Document,
	spec: ScatterChartSpec,
	interactions: ChartInteractions,
	circles: SVGCircleElement[],
): void {
	const { plot } = spec;
	if (spec.points.length === 0) return;

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

	const setActive = (index: number): void => {
		if (activeIndex >= 0) circles[activeIndex]?.classList.remove("is-active");
		activeIndex = index;
		if (index >= 0) circles[index]?.classList.add("is-active");
	};
	const hide = (): void => {
		setActive(-1);
		tooltip.classList.add("ioto-chart-hidden");
	};
	const showAt = (index: number): void => {
		const point = spec.points[index];
		if (!point) {
			hide();
			return;
		}
		setActive(index);
		renderTooltipRows(
			tooltip,
			point.label,
			[
				{
					label: label(spec.x.labelKey),
					value: spec.x.format(point.valueX),
					className: "ioto-chart-cat-1",
				},
				{
					label: label(spec.y.labelKey),
					value: spec.y.format(point.valueY),
					className: "ioto-chart-cat-1",
				},
			],
			typeof interactions.onActivate === "function",
		);
		tooltip.classList.remove("ioto-chart-hidden");
		positionTooltip(el, svg, spec, point.x, point.y, tooltip);
	};
	const activate = (index: number): void => {
		const point = spec.points[index];
		if (!point || !interactions.onActivate) return;
		interactions.onActivate({ bucketKey: point.bucketKey, path: point.targetPath });
	};
	const indexAt = (event: PointerEvent): number => {
		const pointer = pointerInViewBox(svg, spec, event);
		return nearestPoint(spec.points, pointer.x, pointer.y);
	};

	hit.addEventListener("pointermove", (event) => {
		if (event.pointerType === "touch") return;
		const index = indexAt(event);
		if (index < 0) {
			hide();
			return;
		}
		if (index !== activeIndex) showAt(index);
	});
	hit.addEventListener("click", (event) => {
		activate(indexAt(event as PointerEvent));
	});
	hit.addEventListener("pointerleave", hide);
	hit.addEventListener("pointercancel", hide);
}

export function renderScatterChart(
	el: HTMLElement,
	spec: ScatterChartSpec,
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
		class: "ioto-chart ioto-chart-scatter",
	});
	const summary = svgEl(doc, "title");
	summary.textContent = label(spec.ariaKey);
	svg.appendChild(summary);

	renderAxes(svg, doc, spec);
	const circles = renderPoints(svg, doc, spec);
	if (interactive && interactions) {
		appendInteractionLayer(el, svg, doc, spec, interactions, circles);
	}
	el.appendChild(svg);

	if (spec.hiddenCount > 0) {
		el.createDiv({
			cls: "ioto-chart-more",
			text: t("CHART_SCATTER_TRUNCATED", [String(spec.points.length)]),
		});
	}
}
