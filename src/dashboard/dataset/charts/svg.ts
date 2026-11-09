import { t } from "../../../lang/helpers";
import { barLayout, linePoints } from "./geometry";

const SVG_NS = "http://www.w3.org/2000/svg";
const VIEW_W = 100;
const VIEW_H = 56;
const PAD = 4;

export interface ChartDatum {
	label: string;
	value: number;
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

function emptyState(el: HTMLElement): void {
	el.createDiv({ cls: "ioto-empty-state", text: t("DASHBOARD_NO_SNAPSHOT") });
}

export function renderLineChart(el: HTMLElement, data: ChartDatum[]): void {
	if (data.length === 0) {
		emptyState(el);
		return;
	}
	const doc = el.ownerDocument;
	const width = VIEW_W - PAD * 2;
	const height = VIEW_H - PAD * 2;
	const max = Math.max(1, ...data.map((item) => item.value));
	const points = linePoints(
		data.map((item) => item.value),
		width,
		height,
		max,
	).map((point) => ({ x: point.x + PAD, y: point.y + PAD }));

	const svg = svgEl(doc, "svg", {
		viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
		class: "ioto-chart ioto-chart-line",
		preserveAspectRatio: "none",
	});
	svg.appendChild(
		svgEl(doc, "line", {
			x1: PAD,
			y1: VIEW_H - PAD,
			x2: VIEW_W - PAD,
			y2: VIEW_H - PAD,
			class: "ioto-chart-axis",
		}),
	);
	svg.appendChild(
		svgEl(doc, "polyline", {
			points: points.map((point) => `${point.x},${point.y}`).join(" "),
			class: "ioto-chart-path",
		}),
	);
	points.forEach((point, index) => {
		const circle = svgEl(doc, "circle", {
			cx: point.x,
			cy: point.y,
			r: 1.2,
			class: "ioto-chart-dot",
		});
		const title = svgEl(doc, "title");
		const datum = data[index];
		title.textContent = datum
			? `${datum.label}: ${datum.value}`
			: String(point.x);
		circle.appendChild(title);
		svg.appendChild(circle);
	});
	el.appendChild(svg);
}

export function renderBarChart(el: HTMLElement, data: ChartDatum[]): void {
	if (data.length === 0) {
		emptyState(el);
		return;
	}
	const doc = el.ownerDocument;
	const max = Math.max(1, ...data.map((item) => item.value));
	const svg = svgEl(doc, "svg", {
		viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
		class: "ioto-chart ioto-chart-bar",
		preserveAspectRatio: "none",
	});
	const bars = barLayout(
		data.map((item) => item.value),
		VIEW_W - PAD * 2,
		VIEW_H - PAD * 2,
		4,
		max,
	);
	bars.forEach((bar, index) => {
		const rect = svgEl(doc, "rect", {
			x: bar.x + PAD,
			y: bar.y + PAD,
			width: bar.w,
			height: bar.h,
			class: "ioto-chart-bar-rect",
			rx: 0.8,
		});
		const title = svgEl(doc, "title");
		const datum = data[index];
		title.textContent = datum
			? `${datum.label}: ${datum.value}`
			: String(bar.h);
		rect.appendChild(title);
		svg.appendChild(rect);
	});
	el.appendChild(svg);

	const legend = el.createDiv({ cls: "ioto-chart-legend" });
	for (const datum of data.slice(0, 8)) {
		const item = legend.createDiv({ cls: "ioto-chart-legend-item" });
		item.createSpan({ cls: "ioto-chart-legend-label", text: datum.label });
		item.createSpan({
			cls: "ioto-chart-legend-value",
			text: String(datum.value),
		});
	}
}
