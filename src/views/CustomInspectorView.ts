import { ItemView, WorkspaceLeaf } from "obsidian";
import { CUSTOM_INSPECTOR_VIEW_TYPE } from "../models/constants";
import type IotoDashboardPlugin from "../main";
import { t } from "../lang/helpers";
import { ConfirmModal } from "../ui/ConfirmModal";
import {
	ComponentInspector,
	type ComponentInspectorDeps,
} from "./components/ComponentInspector";

/** Right-sidebar host for the component settings panel. */
export class CustomInspectorView extends ItemView {
	private inspector: ComponentInspector | null = null;
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
		this.inspector = new ComponentInspector(this.contentEl, this.deps());
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

	private deps(): ComponentInspectorDeps {
		const controller = () =>
			this.plugin.inspectorService.current()?.controller;
		return {
			patch: (patch) => controller()?.patch(patch),
			stepSize: (axis, direction) =>
				controller()?.stepSize(axis, direction),
			resetSize: () => controller()?.resetSize(),
			move: (offset) => controller()?.move(offset),
			remove: () => this.confirmRemove(),
		};
	}

	private renderInspector(): void {
		if (!this.inspector) return;
		const service = this.plugin.inspectorService;
		const snapshot = service.snapshot();
		const focus = service.consumeFocus();
		this.inspector.render(snapshot ? { ...snapshot, focus } : null);
	}

	private confirmRemove(): void {
		const controller =
			this.plugin.inspectorService.current()?.controller;
		if (!controller?.getTarget()) return;
		new ConfirmModal(
			this.app,
			t("INSPECTOR_TITLE"),
			t("INSPECTOR_REMOVE_CONFIRM"),
			() => controller.remove(),
		).open();
	}
}
