import { Menu, Platform, setIcon, setTooltip } from "obsidian";
import { t } from "../../lang/helpers";
import type { PagesInspectorState } from "../../dashboard/inspector-service";
import { dropIndex, type CardRect } from "../../dashboard/layout";
import { armPointerDrag, bindPointerSession } from "../../ui/pointer-session";

export interface PagesInspectorDeps {
	switchTo(pageId: string): void;
	create(): void;
	duplicate(pageId: string): void;
	rename(pageId: string): void;
	remove(pageId: string): void;
	/** `mode: "index"` targets a position; `"step"` moves by ±1. */
	move(pageId: string, target: number, mode: "index" | "step"): void;
}

/**
 * Page manager panel: reorder, switch, create, duplicate, rename and delete
 * pages. Reads everything from the passed state and writes only through `deps`.
 */
export class PagesInspector {
	private root: HTMLElement;
	private signature = "";
	private state: PagesInspectorState | null = null;
	private listEl: HTMLElement | null = null;
	// Guards the click that follows a row drag from switching pages.
	private suppressRowClick = false;

	constructor(
		container: HTMLElement,
		private deps: PagesInspectorDeps,
	) {
		this.root = container.createDiv({
			cls: "ioto-inspector ioto-pages-inspector",
		});
	}

	render(state: PagesInspectorState | null): void {
		if (!state) {
			this.renderEmpty();
			return;
		}
		const signature = this.signatureOf(state);
		if (signature !== this.signature) {
			const scrollTop = this.root.scrollTop;
			this.signature = signature;
			this.build(state);
			this.root.scrollTop = scrollTop;
		}
		this.state = state;
	}

	destroy(): void {
		this.root.remove();
	}

	private signatureOf(state: PagesInspectorState): string {
		const target = state.target;
		return [
			target.dashboardId,
			target.activePageId,
			state.editable ? "edit" : "view",
			target.pages
				.map(
					(page) =>
						`${page.id}:${page.name}:${page.componentCount}:${
							page.isActive ? "a" : "-"
						}:${page.canDelete ? "d" : "-"}`,
				)
				.join("|"),
		].join("#");
	}

	private renderEmpty(): void {
		if (this.signature === "empty") return;
		this.signature = "empty";
		this.listEl = null;
		this.root.empty();
		this.root.removeClass("is-readonly");
		this.root.createDiv({
			cls: "ioto-inspector-empty-title",
			text: t("INSPECTOR_EMPTY_TITLE"),
		});
		this.root.createDiv({
			cls: "ioto-inspector-empty-desc",
			text: t("INSPECTOR_EMPTY_DESC"),
		});
	}

	private build(state: PagesInspectorState): void {
		this.root.empty();
		this.root.toggleClass("is-readonly", !state.editable);

		const header = this.root.createDiv({ cls: "ioto-inspector-header" });
		const heading = header.createDiv({ cls: "ioto-inspector-breadcrumb" });
		heading.createSpan({
			cls: "ioto-inspector-crumb-current",
			attr: { "aria-current": "page" },
			text: t("DASHBOARD_PAGES_TITLE"),
		});
		heading.createSpan({
			cls: "ioto-inspector-crumb-sep",
			attr: { "aria-hidden": "true" },
			text: "·",
		});
		heading.createSpan({
			cls: "ioto-inspector-crumb-plain",
			text: state.target.dashboardName,
		});
		const add = header.createEl("button", {
			cls: "clickable-icon",
			attr: {
				type: "button",
				"aria-label": t("DASHBOARD_PAGES_ADD"),
			},
		});
		setIcon(add, "plus");
		setTooltip(add, t("DASHBOARD_PAGES_ADD"));
		add.disabled = !state.editable;
		add.onClickEvent(() => {
			if (this.state?.editable) this.deps.create();
		});

		const list = this.root.createDiv({ cls: "ioto-pages-list" });
		this.listEl = list;
		state.target.pages.forEach((page, index) => {
			const total = state.target.pages.length;
			const row = list.createDiv({
				cls: `ioto-pages-row${page.isActive ? " is-active" : ""}`,
				attr: {
					"data-page-id": page.id,
					role: "button",
					tabindex: "0",
					...(page.isActive ? { "aria-current": "page" } : {}),
				},
			});
			const handle = row.createDiv({
				cls: "ioto-pages-handle",
				attr: { title: t("PAGE_MOVE_DRAG"), "aria-hidden": "true" },
			});
			setIcon(handle, "grip-vertical");

			row.createDiv({ cls: "ioto-pages-name", text: page.name });
			row.createSpan({
				cls: "ioto-pages-count",
				text: t("PAGE_SETTINGS_COMPONENTS", [
					String(page.componentCount),
				]),
			});

			row.addEventListener("click", (event) => {
				if (this.suppressRowClick) return;
				if ((event.target as HTMLElement | null)?.closest("button")) {
					return;
				}
				this.deps.switchTo(page.id);
			});
			row.addEventListener("keydown", (event) => {
				if (event.target !== row) return;
				if (event.key !== "Enter" && event.key !== " ") return;
				event.preventDefault();
				this.deps.switchTo(page.id);
			});

			if (Platform.isMobile) {
				this.createMoveButton(
					row,
					page.id,
					index,
					total,
					-1,
					"arrow-up",
					t("PAGE_MOVE_UP"),
					state.editable,
				);
				this.createMoveButton(
					row,
					page.id,
					index,
					total,
					1,
					"arrow-down",
					t("PAGE_MOVE_DOWN"),
					state.editable,
				);
			}
			this.createMenuButton(
				row,
				page,
				index,
				total,
				state.editable,
			);

			if (!Platform.isMobile && state.editable) {
				row.addEventListener("pointerdown", (event) => {
					if ((event.target as HTMLElement | null)?.closest("button")) {
						return;
					}
					this.armRowDrag(row, event);
				});
			}
		});
	}

	private createMoveButton(
		row: HTMLElement,
		pageId: string,
		index: number,
		total: number,
		direction: -1 | 1,
		icon: string,
		label: string,
		editable: boolean,
	): void {
		const button = row.createEl("button", {
			cls: "clickable-icon ioto-pages-move",
			attr: { type: "button", "aria-label": label },
		});
		setIcon(button, icon);
		setTooltip(button, label);
		button.disabled =
			!editable ||
			(direction === -1 ? index === 0 : index === total - 1);
		button.onClickEvent(() => this.deps.move(pageId, direction, "step"));
	}

	private createMenuButton(
		row: HTMLElement,
		page: PagesInspectorState["target"]["pages"][number],
		index: number,
		total: number,
		editable: boolean,
	): void {
		const button = row.createEl("button", {
			cls: "clickable-icon ioto-pages-more",
			attr: {
				type: "button",
				"aria-label": t("INSPECTOR_MORE_ACTIONS"),
				"aria-haspopup": "menu",
			},
		});
		setIcon(button, "more-horizontal");
		setTooltip(button, t("INSPECTOR_MORE_ACTIONS"));
		button.disabled = !editable;
		button.onClickEvent((event) =>
			this.openMenu(event, button, page, index, total),
		);
	}

	private openMenu(
		event: MouseEvent,
		button: HTMLButtonElement,
		page: PagesInspectorState["target"]["pages"][number],
		index: number,
		total: number,
	): void {
		if (!this.state?.editable) return;
		const menu = new Menu();
		menu.addItem((item) => {
			item.setTitle(t("PAGE_RENAME"))
				.setIcon("pencil")
				.onClick(() => this.deps.rename(page.id));
		});
		menu.addItem((item) => {
			item.setTitle(t("PAGE_DUPLICATE"))
				.setIcon("copy")
				.onClick(() => this.deps.duplicate(page.id));
		});
		menu.addSeparator();
		menu.addItem((item) => {
			item.setTitle(t("PAGE_MOVE_UP"))
				.setIcon("arrow-up")
				.setDisabled(index === 0)
				.onClick(() => this.deps.move(page.id, -1, "step"));
		});
		menu.addItem((item) => {
			item.setTitle(t("PAGE_MOVE_DOWN"))
				.setIcon("arrow-down")
				.setDisabled(index === total - 1)
				.onClick(() => this.deps.move(page.id, 1, "step"));
		});
		menu.addSeparator();
		menu.addItem((item) => {
			item.setTitle(
				page.canDelete
					? t("PAGE_DELETE")
					: t("PAGE_LAST_CANNOT_DELETE"),
			)
				.setIcon("trash-2")
				.setWarning(page.canDelete)
				.setDisabled(!page.canDelete)
				.onClick(() => {
					if (!page.canDelete) return;
					this.deps.remove(page.id);
				});
		});
		if (event.detail > 0) {
			menu.showAtMouseEvent(event);
			return;
		}
		const rect = button.getBoundingClientRect();
		menu.showAtPosition({ x: rect.right, y: rect.bottom });
	}

	private armRowDrag(row: HTMLElement, event: PointerEvent): void {
		armPointerDrag(row, event, {
			onActivate: (startEvent) => this.startRowDrag(row, startEvent),
		});
	}

	private startRowDrag(row: HTMLElement, startEvent: PointerEvent): void {
		const list = this.listEl;
		const listParent = row.parentElement;
		if (!list || listParent !== list) return;
		const pageId = row.dataset.pageId ?? "";
		if (!pageId) return;
		this.suppressRowClick = true;
		startEvent.preventDefault();
		try {
			row.setPointerCapture(startEvent.pointerId);
		} catch {
			// Capture is best-effort; document listeners still receive moves.
		}
		const win = row.ownerDocument.defaultView ?? window;
		row.addClass("is-dragging");

		const preview = (y: number): void => {
			const rows = Array.from(
				list.querySelectorAll<HTMLElement>(
					".ioto-pages-row[data-page-id]",
				),
			);
			const rects: CardRect[] = [];
			for (const element of rows) {
				const rect = element.getBoundingClientRect();
				rects.push({
					id: element.dataset.pageId ?? "",
					top: rect.top,
					left: rect.left,
					width: rect.width,
					height: rect.height,
				});
			}
			const others = rows.filter((element) => element !== row);
			const reference =
				others[dropIndex(rects, Number.MAX_SAFE_INTEGER, y, pageId)] ??
				null;
			if (row.nextElementSibling === reference) return;
			const reduceMotion =
				typeof win.matchMedia === "function" &&
				win.matchMedia("(prefers-reduced-motion: reduce)").matches;
			if (reduceMotion) {
				list.insertBefore(row, reference);
				return;
			}
			const first = new Map<HTMLElement, DOMRect>();
			for (const element of others) {
				first.set(element, element.getBoundingClientRect());
			}
			list.insertBefore(row, reference);
			for (const element of others) {
				const before = first.get(element);
				if (!before) continue;
				const after = element.getBoundingClientRect();
				const dy = before.top - after.top;
				if (dy === 0) continue;
				element.animate(
					[
						{ transform: `translateY(${dy}px)` },
						{ transform: "none" },
					],
					{ duration: 160, easing: "cubic-bezier(.2,.8,.2,1)" },
				);
			}
		};

		bindPointerSession(row, startEvent.pointerId, {
			onMove: (moveEvent) => preview(moveEvent.clientY),
			onFinish: (cancelled) => {
				row.removeClass("is-dragging");
				win.setTimeout(() => {
					this.suppressRowClick = false;
				}, 0);
				if (cancelled) {
					// Preview reordering mutated the list; rebuild from state.
					this.signature = "";
					if (this.state) this.render(this.state);
					return;
				}
				const rows = Array.from(
					list.querySelectorAll<HTMLElement>(
						".ioto-pages-row[data-page-id]",
					),
				);
				const target = rows.findIndex(
					(element) => element.dataset.pageId === pageId,
				);
				if (target < 0) return;
				const from = this.state?.target.pages.findIndex(
					(page) => page.id === pageId,
				);
				if (from === target) return;
				this.deps.move(pageId, target, "index");
			},
		});
	}
}
