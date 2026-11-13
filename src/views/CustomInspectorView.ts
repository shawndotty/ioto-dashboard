import { ItemView, WorkspaceLeaf } from "obsidian";
import { CUSTOM_INSPECTOR_VIEW_TYPE } from "../models/constants";
import type IotoDashboardPlugin from "../main";
import { t } from "../lang/helpers";
import { ConfirmModal } from "../ui/ConfirmModal";
import {
	InspectorPanel,
	type InspectorPanelDeps,
	type InspectorPanelState,
} from "./components/InspectorPanel";

/** Right-sidebar host for the component and page settings panels. */
export class CustomInspectorView extends ItemView {
	private inspector: InspectorPanel | null = null;
	private unsubscribe: (() => void) | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: IotoDashboardPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return CUSTOM_INSPECTOR_VIEW_TYPE;
	}

	getDisplayText(): string {
		return t("INSPECTOR_TITLE");
	}

	getIcon(): string {
		return "sliders-horizontal";
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("ioto-inspector-view");
		this.inspector = new InspectorPanel(this.contentEl, this.deps());
		this.unsubscribe = this.plugin.inspectorService.subscribe(() =>
			this.renderInspector(),
		);
		this.renderInspector();
	}

	async onClose(): Promise<void> {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.inspector?.destroy();
		this.inspector = null;
	}

	private deps(): InspectorPanelDeps {
		const controller = () => this.plugin.inspectorService.current()?.controller;
		const component = () => {
			const current = controller();
			return current?.kind === "component" ? current : null;
		};
		const page = () => {
			const current = controller();
			return current?.kind === "page" ? current : null;
		};
		return {
			component: {
				patch: (patch) => component()?.patch(patch),
				stepSize: (axis, direction) =>
					component()?.stepSize(axis, direction),
				resetSize: () => component()?.resetSize(),
				move: (offset) => component()?.move(offset),
				duplicate: () => component()?.duplicate(),
				moveTo: () => component()?.moveTo(),
				remove: () => this.confirmRemove(),
				openPageSettings: () => component()?.openPageSettings(),
				pickTarget: (picker, key) => component()?.pickTarget(picker, key),
				describeTarget: (picker, value) =>
					component()?.describeTarget(picker, value) ?? value,
			},
			page: {
				rename: (name) => page()?.renamePage(name),
				duplicate: () => page()?.duplicatePage(),
				setLayout: (columns, rowHeight) =>
					page()?.setPageLayout(columns, rowHeight),
				remove: () => page()?.removePage(),
			},
		};
	}

	private renderInspector(): void {
		if (!this.inspector) return;
		const service = this.plugin.inspectorService;
		const snapshot = service.snapshot();
		const focus = service.consumeFocus();
		const state = (snapshot
			? { ...snapshot, focus }
			: null) as InspectorPanelState;
		this.inspector.render(state);
	}

	private confirmRemove(): void {
		const controller = this.plugin.inspectorService.current()?.controller;
		if (controller?.kind !== "component" || !controller.getTarget()) return;
		new ConfirmModal(
			this.app,
			t("INSPECTOR_TITLE"),
			t("INSPECTOR_REMOVE_CONFIRM"),
			() => controller.remove(),
		).open();
	}
}
