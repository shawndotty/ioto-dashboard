import { t } from "../../lang/helpers";
import { Category } from "../../models/types";
import { SavedQuery } from "../../settings";

export class LeftSidebar {
	constructor(
		private container: HTMLElement,
		private activeCategory: Category,
		private activeQueryId: string | null,
		private leftPanelCollapsed: boolean,
		private savedQueries: SavedQuery[],
		private onCategoryClick: (category: Category) => void,
		private onQueryClick: (query: SavedQuery) => void,
		private navItems: Category[] = ["Input", "Output", "Outcome"]
	) {}

	render() {
		this.container.empty();

		const header = this.container.createDiv({ cls: "nav-header" });
		if (!this.leftPanelCollapsed) {
			header.createEl("h3", { text: t("NAV_TITLE") });
		}

		// Optional: Add toggle button logic if needed here, or keep it controlled by parent

		const list = this.container.createEl("ul", { cls: "nav-list" });

		this.navItems.forEach((item) => {
			let label = "";
			if (item === "Input") label = t("NAV_INPUT");
			else if (item === "Output") label = t("NAV_OUTPUT");
			else if (item === "Outcome") label = t("NAV_OUTCOME");
			else if (item === "Tasks") label = t("NAV_TASKS");

			const li = list.createEl("li", {
				text: this.leftPanelCollapsed ? label.charAt(0) : label,
				cls: "nav-item",
			});
			if (item === this.activeCategory && !this.activeQueryId)
				li.addClass("is-active");

			li.onclick = () => {
				this.onCategoryClick(item);
			};
		});

		// Saved Queries
		if (this.savedQueries.length > 0) {
			const divider = this.container.createDiv({ cls: "nav-divider" });
			divider.style.borderTop =
				"1px solid var(--background-modifier-border)";
			divider.style.margin = "10px 0";

			const queryHeader = this.container.createDiv({ cls: "nav-header" });
			if (!this.leftPanelCollapsed) {
				queryHeader.createEl("h3", { text: t("NAV_USER_QUERIES") });
			}

			const queryList = this.container.createEl("ul", { cls: "nav-list" });
			this.savedQueries.forEach((query) => {
				const li = queryList.createEl("li", {
					text: this.leftPanelCollapsed
						? query.name.charAt(0)
						: query.name,
					cls: "nav-item",
				});
				if (this.activeQueryId === query.id) li.addClass("is-active");
				// Add a tooltip if collapsed
				if (this.leftPanelCollapsed) {
					li.setAttribute("aria-label", query.name);
				}

				li.onclick = () => {
					this.onQueryClick(query);
				};
			});
		}
	}
}
