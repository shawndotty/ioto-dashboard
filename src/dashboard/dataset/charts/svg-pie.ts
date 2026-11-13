import { t } from "../../../lang/helpers";
import { polarPoint } from "./geometry";
import type { PieChartSpec, PieSliceSpec } from "./pie-spec";
import type { ChartInteractions } from "./svg";
import {
	label,
	positionTooltip,
	renderTooltipRows,
	setHidden,
	svgEl,
} from "./svg-base";

const MIN_INNER_LABEL_WIDTH = 200;
const MIN_INNER_LABEL_PERCENT = 0.05;

function sliceLabel(slice: PieSliceSpec): string {
	return slice.labelKey ? label(slice.labelKey) : slice.label;
}

function innerLabelText(spec: PieChartSpec, slice: PieSliceSpec): string {
	const percent = `${slice.integerPercent}%`;
	const value = spec.formatValue(slice.value);
	if (spec.labelMode === "value") return value;
	if (spec.labelMode === "both") return `${value} · ${percent}`;
	return percent;
}

function renderLegend(el: HTMLElement, spec: PieChartSpec): void {
	if (!spec.showLegend || spec.slices.length === 0) return;
	const legend = el.createDiv({ cls: "ioto-chart-legend is-wrap" });
	for (const slice of spec.slices) {
		const item = legend.createDiv({ cls: "ioto-chart-legend-item" });
		item.createSpan({
			cls: `ioto-chart-legend-swatch ${slice.className}`,
		});
		item.createSpan({
			cls: "ioto-chart-legend-label",
			text: sliceLabel(slice),
		});
		item.createSpan({
			cls: "ioto-chart-legend-value",
			text: `${spec.formatValue(slice.value)} · ${slice.integerPercent}%`,
		});
	}
}

function renderValueList(el: HTMLElement, spec: PieChartSpec): void {
	if (!spec.valueList || spec.valueList.length === 0) return;
	const list = el.createDiv({ cls: "ioto-chart-values" });
	list.style.maxHeight = `${Math.min(spec.valueList.length, 6) * 20}px`;
	for (const entry of spec.valueList) {
		const item = list.createDiv({ cls: "ioto-chart-value-item" });
		item.createSpan({
			cls: "ioto-chart-value-label",
			text: entry.labelKey ? label(entry.labelKey) : entry.label,
		});
		item.createSpan({ cls: "ioto-chart-value-text", text: entry.text });
	}
}

export function renderPieChart(
	el: HTMLElement,
	spec: PieChartSpec,
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

	const tooltip = interactive
		? el.createDiv({ cls: "ioto-chart-tooltip ioto-chart-hidden" })
		: null;

	spec.slices.forEach((slice) => {
		if (!slice.path) return;
		const path = svgEl(doc, "path", {
			d: slice.path,
			class: `ioto-chart-slice ${slice.className}`,
			"data-bucket-key": slice.bucketKey,
		});
		svg.appendChild(path);

		if (spec.labelMode !== "none") {
			const showInner =
				slice.percent >= MIN_INNER_LABEL_PERCENT &&
				spec.width >= MIN_INNER_LABEL_WIDTH;
			if (showInner) {
				const mid = (slice.startAngle + slice.endAngle) / 2;
				const midRadius = (spec.radius + spec.innerRadius) / 2;
				const point = polarPoint(
					spec.center.x,
					spec.center.y,
					midRadius,
					mid,
				);
				const text = svgEl(doc, "text", {
					x: point.x,
					y: point.y,
					dy: "0.32em",
					class: "ioto-chart-slice-label",
				});
				text.textContent = innerLabelText(spec, slice);
				svg.appendChild(text);
			}
		}

		if (!interactive || !interactions) return;
		const anchor = polarPoint(
			spec.center.x,
			spec.center.y,
			(spec.radius + spec.innerRadius) / 2,
			(slice.startAngle + slice.endAngle) / 2,
		);
		const show = (): void => {
			path.classList.add("is-active");
			if (!tooltip) return;
			renderTooltipRows(
				tooltip,
				sliceLabel(slice),
				[
					{
						label: label("SETTING_PIE_SLICE_VALUE"),
						value: spec.formatValue(slice.value),
						className: slice.className,
					},
					{
						label: label("SETTING_PIE_SLICE_PERCENT"),
						value: `${slice.integerPercent}%`,
						className: slice.className,
					},
				],
				slice.bucketKey !== "other" &&
					typeof interactions.onActivate === "function",
			);
			tooltip.classList.remove("ioto-chart-hidden");
			positionTooltip(el, svg, spec, anchor.x, anchor.y, tooltip);
		};
		const hide = (): void => {
			path.classList.remove("is-active");
			if (tooltip) tooltip.classList.add("ioto-chart-hidden");
		};
		path.addEventListener("pointerenter", (event) => {
			if (event.pointerType === "touch") return;
			show();
		});
		path.addEventListener("pointerleave", hide);
		path.addEventListener("pointercancel", hide);
		path.addEventListener("click", () => {
			if (slice.bucketKey === "other") return;
			interactions.onActivate?.({
				bucketKey: slice.bucketKey,
				path: slice.targetPath,
			});
		});
	});

	if (spec.kind === "donut") {
		const total = svgEl(doc, "text", {
			x: spec.center.x,
			y: spec.center.y - 2,
			dy: "0.32em",
			class: "ioto-chart-donut-center is-total",
		});
		total.textContent = spec.totalText;
		svg.appendChild(total);
		const caption = svgEl(doc, "text", {
			x: spec.center.x,
			y: spec.center.y + 14,
			dy: "0.32em",
			class: "ioto-chart-donut-center is-caption",
		});
		caption.textContent = label(spec.totalLabelKey);
		svg.appendChild(caption);
	}

	el.appendChild(svg);
	if (tooltip) setHidden(tooltip, true);

	renderLegend(el, spec);
	renderValueList(el, spec);

	if (spec.hiddenCount > 0) {
		el.createDiv({
			cls: "ioto-chart-more",
			text: t("SETTING_AXIS_MORE_ITEMS", [String(spec.hiddenCount)]),
		});
	}
}
