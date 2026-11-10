import { t } from "../../../lang/helpers";
import type { ChartSize, ChartSpec } from "./spec";
import { renderChart } from "./svg";

/** Height consumed by the HTML legend / value list rendered below the SVG. */
function extrasHeight(spec: ChartSpec): number {
	let height = 0;
	if (spec.showLegend) height += 22;
	if (spec.valueList && spec.valueList.length > 0) {
		height += Math.min(spec.valueList.length, 6) * 20;
	}
	if (spec.hiddenCount > 0) height += 20;
	return height;
}

/**
 * Cards are rendered before being appended to the grid, so the first frame has
 * no measurable size. Observe the host, redraw once real pixels exist, and skip
 * detached frames so a removed card cannot leak its observer.
 */
export function renderResponsiveChart(
	el: HTMLElement,
	build: (size: ChartSize) => ChartSpec | null,
	minHeight = 80,
): void {
	const root = el.createDiv({ cls: "ioto-chart-host" });
	let frame = 0;
	let wasConnected = false;
	let lastWidth = -1;
	let lastHeight = -1;

	const paint = (): void => {
		frame = 0;
		if (!root.isConnected) return;
		wasConnected = true;
		const rect = root.getBoundingClientRect();
		let width = Math.round(rect.width);
		let height = Math.round(rect.height);
		if (height <= 0 && el.isConnected) height = el.clientHeight - 24;
		if (width <= 0 && el.isConnected) width = el.clientWidth - 24;
		if (width <= 0 || height < minHeight) return;
		if (width === lastWidth && height === lastHeight) return;
		lastWidth = width;
		lastHeight = height;

		const size = { w: width, h: height };
		let spec = build(size);
		if (!spec) {
			root.empty();
			root.createDiv({
				cls: "ioto-empty-state",
				text: t("DASHBOARD_NO_SNAPSHOT"),
			});
			return;
		}
		const reserved = extrasHeight(spec);
		if (reserved > 0 && height - reserved >= minHeight) {
			spec = build({ w: width, h: height - reserved }) ?? spec;
		}
		root.empty();
		renderChart(root, spec);
	};

	const schedule = (): void => {
		if (frame) return;
		frame = requestAnimationFrame(paint);
	};

	const observer = new ResizeObserver(() => {
		if (!root.isConnected) {
			if (wasConnected) {
				observer.disconnect();
				if (frame) cancelAnimationFrame(frame);
				frame = 0;
			}
			return;
		}
		wasConnected = true;
		schedule();
	});
	observer.observe(root);
	schedule();
}
