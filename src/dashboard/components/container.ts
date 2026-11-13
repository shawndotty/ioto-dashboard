import { t } from "../../lang/helpers";
import type { ComponentDefinition } from "../registry";

export const containerComponent: ComponentDefinition = {
	type: "container",
	labelKey: "COMPONENT_CONTAINER_NAME",
	descriptionKey: "COMPONENT_CONTAINER_DESC",
	icon: "layout-panel-top",
	category: "utility",
	queryless: true,
	acceptsChildren: true,
	defaultQueryId: "",
	createConfig: () => ({
		queryId: "",
		w: 6,
		h: 4,
		children: [],
		options: {
			columns: 12,
			rowHeight: 56,
			gap: 8,
			padding: 8,
			borderWidth: 1,
			radius: 10,
		},
	}),
	size: { minW: 2, minH: 2, maxH: 24 },
	isEmpty: () => false,
	settings: [
		{ key: "title", kind: "text", group: "display" },
		{
			key: "columns",
			kind: "number",
			group: "display",
			min: 4,
			max: 24,
			fallback: 12,
			target: "options",
			labelKey: "SETTING_CONTAINER_COLUMNS",
		},
		{
			key: "rowHeight",
			kind: "number",
			group: "display",
			min: 40,
			max: 120,
			fallback: 56,
			target: "options",
			labelKey: "SETTING_CONTAINER_ROW_HEIGHT",
		},
		{
			key: "gap",
			kind: "number",
			group: "style",
			min: 0,
			max: 24,
			fallback: 8,
			target: "options",
			labelKey: "SETTING_CONTAINER_GAP",
		},
		{
			key: "padding",
			kind: "number",
			group: "style",
			min: 0,
			max: 24,
			fallback: 8,
			target: "options",
			labelKey: "SETTING_CONTAINER_PADDING",
		},
		{
			key: "borderWidth",
			kind: "number",
			group: "style",
			min: 0,
			max: 4,
			fallback: 1,
			target: "options",
			labelKey: "SETTING_CONTAINER_BORDER_WIDTH",
		},
		{
			key: "borderColor",
			kind: "color",
			group: "style",
			target: "options",
			labelKey: "SETTING_CONTAINER_BORDER_COLOR",
		},
		{
			key: "radius",
			kind: "number",
			group: "style",
			min: 0,
			max: 24,
			fallback: 10,
			target: "options",
			labelKey: "SETTING_CONTAINER_RADIUS",
		},
	],
	render: (el, ctx) => {
		// The nested grid already exists; only the edit-mode empty hint is ours.
		if (!ctx.editMode) return;
		if ((ctx.config.children?.length ?? 0) > 0) return;
		el.createDiv({
			cls: "ioto-container-empty",
			text: t("CONTAINER_EMPTY_HINT"),
		});
	},
};
