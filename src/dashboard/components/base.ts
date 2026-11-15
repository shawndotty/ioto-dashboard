import { t } from "../../lang/helpers";
import type { ComponentDefinition } from "../registry";

function renderBaseEmpty(
	el: HTMLElement,
	key: Parameters<typeof t>[0],
	args?: string[],
): void {
	el.createDiv({ cls: "ioto-base-empty", text: t(key, args) });
}

/**
 * Queryless card that mounts an existing `.base` file through the view host.
 * The host owns the embed lifecycle, fallback and view-name validation; this
 * component only maps its result onto a localized empty state.
 */
export const baseComponent: ComponentDefinition = {
	type: "base",
	labelKey: "COMPONENT_BASE_NAME",
	descriptionKey: "COMPONENT_BASE_DESC",
	icon: "table-2",
	category: "utility",
	queryless: true,
	defaultQueryId: "",
	createConfig: () => ({
		queryId: "",
		options: { basePath: "", view: "", hideToolbar: false },
		w: 6,
		h: 5,
	}),
	size: { minW: 4, minH: 3, maxH: 24 },
	isEmpty: () => false,
	settings: [
		{ key: "title", kind: "text", group: "display" },
		{
			key: "basePath",
			kind: "target",
			picker: "base",
			group: "data",
			labelKey: "SETTING_BASE_FILE",
			target: "options",
		},
		{
			key: "view",
			kind: "target",
			picker: "baseView",
			group: "data",
			labelKey: "SETTING_BASE_VIEW",
			target: "options",
			hintKey: "SETTING_BASE_VIEW_HINT",
		},
		{
			key: "hideToolbar",
			kind: "toggle",
			group: "display",
			labelKey: "SETTING_BASE_HIDE_TOOLBAR",
			fallback: false,
			target: "options",
			hintKey: "SETTING_BASE_HIDE_TOOLBAR_HINT",
		},
	],
	render: (el, ctx) => {
		const path =
			typeof ctx.config.options?.basePath === "string"
				? ctx.config.options.basePath
				: "";
		const view =
			typeof ctx.config.options?.view === "string"
				? ctx.config.options.view
				: "";
		const hideToolbar = ctx.config.options?.hideToolbar === true;
		if (!path) {
			renderBaseEmpty(el, "BASE_EMPTY_HINT");
			return;
		}

		el.addClass("ioto-base-body");
		void (async () => {
			const result =
				(await ctx.mountBaseEmbed?.(el, path, view, hideToolbar)) ??
				"disabled";
			if (!el.isConnected || result === "ok") return;
			el.empty();
			const key =
				result === "missing"
					? "BASE_MISSING"
					: result === "view"
						? "BASE_VIEW_MISSING"
						: "BASE_DISABLED";
			renderBaseEmpty(el, key, [path]);
		})();
	},
};