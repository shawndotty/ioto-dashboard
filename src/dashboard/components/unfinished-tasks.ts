import { t } from "../../lang/helpers";
import type { ComponentDefinition } from "../registry";

export const unfinishedTasksComponent: ComponentDefinition = {
	type: "unfinished-tasks",
	labelKey: "COMPONENT_UNFINISHED_NAME",
	descriptionKey: "COMPONENT_UNFINISHED_DESC",
	defaultQueryId: "builtin:tasks-unfinished",
	createConfig: (queryId) => ({ queryId, basis: "section", limit: 20, w: 6, h: 3 }),
	toMetricRequest: (config) => ({
		kind: "unfinished-tasks",
		queryId: config.queryId,
		basis: config.basis ?? "section",
		limit: config.limit ?? 20,
	}),
	isEmpty: (result) => (result.items ?? []).length === 0,
	render: (el, ctx) => {
		el.addClass("ioto-unfinished");
		const items = ctx.result?.items ?? [];
		if (items.length === 0) {
			el.createDiv({ cls: "ioto-empty-state", text: t("UNFINISHED_EMPTY") });
			return;
		}
		const list = el.createDiv({ cls: "ioto-unfinished-list" });
		for (const item of items) {
			const row = list.createDiv({ cls: "ioto-unfinished-row" });
			row.setAttr("role", "button");
			row.setAttr("tabindex", "0");
			const open = () => ctx.openNote(item.path, item.line);
			row.onClickEvent(open);
			row.addEventListener("keydown", (event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					open();
				}
			});
			row.createDiv({ cls: "ioto-unfinished-text", text: item.text });
			row.createDiv({
				cls: "ioto-unfinished-meta",
				text: `${item.noteBasename}${item.project ? ` · ${item.project}` : ""}`,
			});
		}
	},
};
