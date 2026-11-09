import { App, FuzzySuggestModal } from "obsidian";
import { t } from "../lang/helpers";
import type { DashboardWorkspace } from "../dashboard/types";

export class DashboardPickerModal extends FuzzySuggestModal<DashboardWorkspace> {
	constructor(
		app: App,
		private dashboards: DashboardWorkspace[],
		private onChoose: (dashboard: DashboardWorkspace) => void,
	) {
		super(app);
		this.setPlaceholder(t("COMMAND_OPEN_DASHBOARD_PICKER"));
	}

	getItems(): DashboardWorkspace[] {
		return this.dashboards;
	}

	getItemText(item: DashboardWorkspace): string {
		return item.name;
	}

	onChooseItem(item: DashboardWorkspace): void {
		this.onChoose(item);
	}
}
