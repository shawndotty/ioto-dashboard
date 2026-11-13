import { t } from "../../lang/helpers";
import type { ComponentDefinition } from "../registry";
import type { DashboardComponentConfig } from "../types";

/** Editing drafts keyed by config object; a repository write replaces it. */
const drafts = new WeakMap<DashboardComponentConfig, string>();

export const markdownComponent: ComponentDefinition = {
	type: "markdown",
	labelKey: "COMPONENT_MARKDOWN_NAME",
	descriptionKey: "COMPONENT_MARKDOWN_DESC",
	icon: "file-text",
	category: "overview",
	queryless: true,
	defaultQueryId: "",
	createConfig: () => ({
		queryId: "",
		options: { markdown: "", hideTitle: true },
		w: 4,
		h: 3,
	}),
	size: { minW: 2, minH: 1, maxH: 24 },
	isEmpty: () => false,
	settings: [
		{ key: "title", kind: "text", group: "display" },
		{
			key: "markdown",
			kind: "textarea",
			group: "display",
			target: "options",
			labelKey: "SETTING_MARKDOWN_CONTENT",
			placeholderKey: "SETTING_MARKDOWN_PLACEHOLDER",
			hintKey: "SETTING_MARKDOWN_HINT",
		},
	],
	render: (el, ctx) => {
		const stored =
			typeof ctx.config.options?.markdown === "string"
				? ctx.config.options.markdown
				: "";
		if (ctx.editMode) {
			el.addClass("ioto-markdown-editor");
			const area = el.createEl("textarea", {
				cls: "ioto-markdown-input",
				attr: {
					placeholder: t("SETTING_MARKDOWN_PLACEHOLDER"),
					spellcheck: "false",
				},
			});
			area.value = drafts.get(ctx.config) ?? stored;
			area.addEventListener("input", () => {
				// Memory only: writing per keystroke would rebuild the card.
				drafts.set(ctx.config, area.value);
			});
			const commit = (): void => {
				const next = area.value.replace(/\r\n?/g, "\n");
				drafts.set(ctx.config, next);
				if (next === stored) return;
				ctx.patchComponent?.({
					options: { markdown: next.trim() ? next : undefined },
				} as Partial<DashboardComponentConfig>);
			};
			// `change` fires on blur; Cmd/Ctrl+Enter reuses the same path.
			area.addEventListener("change", commit);
			area.addEventListener("keydown", (event) => {
				if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) {
					return;
				}
				event.preventDefault();
				area.blur();
			});
			if (!stored.trim()) {
				el.createDiv({
					cls: "ioto-markdown-hint",
					text: t("MARKDOWN_EMPTY_HINT"),
				});
			}
			return;
		}
		if (!stored.trim()) return;
		el.addClass("ioto-markdown-body");
		void ctx.renderMarkdownFragment?.(el, stored);
	},
};
