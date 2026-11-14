import { t } from "../../../lang/helpers";
import type { ChartInteractions } from "./svg";
import {
	label,
	positionTooltip,
	renderTooltipRows,
	setHidden,
	svgEl,
} from "./svg-base";
import {
	TREEMAP_HEADER_H,
	type TreemapChartSpec,
	type TreemapTileSpec,
} from "./treemap-spec";

const MIN_NAME_WIDTH = 48;
const MIN_NAME_HEIGHT = 18;
const MIN_VALUE_WIDTH = 40;
const MIN_VALUE_HEIGHT = 18;
const MIN_BOTH_HEIGHT = 34;
const MIN_HEADER_TITLE_WIDTH = 40;

function tileTitle(tile: TreemapTileSpec): string {
	if (tile.labelKey) return label(tile.labelKey);
	return tile.fullLabel || tile.label;
}

function tileDisplay(tile: TreemapTileSpec): string {
	return tile.labelKey ? label(tile.labelKey) : tile.label;
}

function isParentTile(
	tile: TreemapTileSpec,
	parentKeys: Set<string>,
): boolean {
	return parentKeys.has(tile.bucketKey);
}

function nativeTitle(tile: TreemapTileSpec, spec: TreemapChartSpec): string {
	return `${tileTitle(tile)}: ${spec.formatValue(tile.value)}`;
}

function renderLegend(el: HTMLElement, spec: TreemapChartSpec): void {
	if (!spec.showLegend) return;
	const roots = spec.tiles.filter((tile) => tile.depth === 0);
	if (roots.length === 0) return;
	const legend = el.createDiv({ cls: "ioto-chart-legend is-wrap" });
	for (const tile of roots) {
		const item = legend.createDiv({ cls: "ioto-chart-legend-item" });
		item.createSpan({
			cls: `ioto-chart-legend-swatch ${tile.className}`,
		});
		item.createSpan({
			cls: "ioto-chart-legend-label",
			text: tileDisplay(tile),
		});
		item.createSpan({
			cls: "ioto-chart-legend-value",
			text: `${spec.formatValue(tile.value)} · ${tile.integerPercent}%`,
		});
	}
}

export function renderTreemapChart(
	el: HTMLElement,
	spec: TreemapChartSpec,
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
		class: "ioto-chart ioto-chart-treemap",
	});
	const summary = svgEl(doc, "title");
	summary.textContent = label(spec.ariaKey);
	svg.appendChild(summary);

	const tooltip = interactive
		? el.createDiv({ cls: "ioto-chart-tooltip ioto-chart-hidden" })
		: null;
	const parentKeys = new Set(
		spec.tiles
			.map((tile) => tile.parentKey)
			.filter((key): key is string => typeof key === "string"),
	);

	const bindTile = (rect: SVGRectElement, tile: TreemapTileSpec): void => {
		if (!interactive || !interactions) return;
		const centerX = tile.rect.x + tile.rect.w / 2;
		const centerY = tile.rect.y + tile.rect.h / 2;
		const show = (): void => {
			rect.classList.add("is-active");
			if (!tooltip) return;
			renderTooltipRows(
				tooltip,
				tileTitle(tile),
				[
					{
						label: label("SETTING_PIE_SLICE_VALUE"),
						value: spec.formatValue(tile.value),
						className: tile.className,
					},
					{
						label: label("SETTING_PIE_SLICE_PERCENT"),
						value: `${tile.integerPercent}%`,
						className: tile.className,
					},
				],
				!tile.isOther && typeof interactions.onActivate === "function",
			);
			tooltip.classList.remove("ioto-chart-hidden");
			positionTooltip(el, svg, spec, centerX, centerY, tooltip);
		};
		const hide = (): void => {
			rect.classList.remove("is-active");
			if (tooltip) tooltip.classList.add("ioto-chart-hidden");
		};
		rect.addEventListener("pointerenter", (event) => {
			if (event.pointerType === "touch") return;
			show();
		});
		rect.addEventListener("pointerleave", hide);
		rect.addEventListener("pointercancel", hide);
		rect.addEventListener("click", () => {
			if (tile.isOther) return;
			interactions.onActivate?.({
				bucketKey: tile.bucketKey,
				path: tile.targetPath,
			});
		});
	};

	const addNativeTitle = (rect: SVGRectElement, tile: TreemapTileSpec): void => {
		const title = svgEl(doc, "title");
		title.textContent = nativeTitle(tile, spec);
		rect.appendChild(title);
	};

	// Groups render first so their children sit on top.
	for (const tile of spec.tiles) {
		if (!isParentTile(tile, parentKeys)) continue;
		if (!(tile.rect.w > 0) || !(tile.rect.h > 0)) continue;
		const rect = svgEl(doc, "rect", {
			x: tile.rect.x,
			y: tile.rect.y,
			width: tile.rect.w,
			height: tile.rect.h,
			rx: 2,
			class: `ioto-chart-treemap-parent ${tile.className}`,
			"data-bucket-key": tile.bucketKey,
		});
		if (!interactive) addNativeTitle(rect, tile);
		svg.appendChild(rect);

		const headerHeight = Math.min(TREEMAP_HEADER_H, tile.rect.h);
		svg.appendChild(
			svgEl(doc, "rect", {
				x: tile.rect.x,
				y: tile.rect.y,
				width: tile.rect.w,
				height: headerHeight,
				rx: 2,
				class: `ioto-chart-treemap-header ${tile.className}`,
			}),
		);
		const display = tileDisplay(tile);
		if (display && tile.rect.w >= MIN_HEADER_TITLE_WIDTH) {
			const text = svgEl(doc, "text", {
				x: tile.rect.x + 4,
				y: tile.rect.y + headerHeight / 2,
				dy: "0.32em",
				class: "ioto-chart-treemap-label",
			});
			text.textContent = display;
			svg.appendChild(text);
		}
		bindTile(rect, tile);
	}

	for (const tile of spec.tiles) {
		if (isParentTile(tile, parentKeys)) continue;
		if (!(tile.rect.w > 0) || !(tile.rect.h > 0)) continue;
		const rect = svgEl(doc, "rect", {
			x: tile.rect.x,
			y: tile.rect.y,
			width: tile.rect.w,
			height: tile.rect.h,
			rx: 2,
			class: `ioto-chart-treemap-tile ${tile.className}`,
			"data-bucket-key": tile.bucketKey,
		});
		if (!interactive) addNativeTitle(rect, tile);
		svg.appendChild(rect);

		const display = tileDisplay(tile);
		const showName =
			spec.labelMode !== "none" &&
			spec.labelMode !== "value" &&
			Boolean(display) &&
			tile.rect.w >= MIN_NAME_WIDTH &&
			tile.rect.h >= MIN_NAME_HEIGHT;
		const showValue =
			spec.labelMode === "value"
				? tile.rect.w >= MIN_VALUE_WIDTH &&
					tile.rect.h >= MIN_VALUE_HEIGHT
				: spec.labelMode === "both" &&
					tile.rect.w >= MIN_VALUE_WIDTH &&
					tile.rect.h >= MIN_BOTH_HEIGHT;

		if (showName) {
			const name = svgEl(doc, "text", {
				x: tile.rect.x + 4,
				y: tile.rect.y + 13,
				class: "ioto-chart-treemap-label",
			});
			name.textContent = display;
			svg.appendChild(name);
		}
		if (showValue) {
			const value = svgEl(doc, "text", {
				x: tile.rect.x + 4,
				y: showName ? tile.rect.y + 27 : tile.rect.y + 13,
				class: "ioto-chart-treemap-value",
			});
			value.textContent = spec.formatValue(tile.value);
			svg.appendChild(value);
		}
		bindTile(rect, tile);
	}

	el.appendChild(svg);
	if (tooltip) setHidden(tooltip, true);

	renderLegend(el, spec);

	if (spec.hiddenCount > 0) {
		el.createDiv({
			cls: "ioto-chart-more",
			text: t("SETTING_AXIS_MORE_ITEMS", [String(spec.hiddenCount)]),
		});
	}
}