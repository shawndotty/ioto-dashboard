import { setIcon } from "obsidian";

export interface PagerLabels {
	prev: string;
	next: string;
	page: (page: number, pageCount: number) => string;
	range: (from: number, to: number, total: number) => string;
}

export interface PagerControls {
	update(page: number, pageCount: number, total: number): void;
}

export interface PagedListHandle<T> {
	readonly page: number;
	readonly pageCount: number;
	goTo(page: number): void;
	setItems(items: readonly T[], options?: { resetPage?: boolean }): void;
}

/** 空列表也按 1 页处理，避免调用方除零；非法每页条数视为不分页。 */
export function pageCountOf(total: number, pageSize: number): number {
	if (!Number.isFinite(pageSize) || pageSize <= 0) return 1;
	return Math.max(1, Math.ceil(total / pageSize));
}

export function clampPage(page: number, pageCount: number): number {
	const value = Math.floor(page);
	if (!Number.isFinite(value)) return 1;
	return Math.min(Math.max(1, value), pageCount);
}

/** 1-based、闭区间的可见条数区间；`total === 0` 时返回 0–0。 */
export function pageBounds(
	page: number,
	pageSize: number,
	total: number,
): { from: number; to: number } {
	if (total === 0) return { from: 0, to: 0 };
	const size = Math.max(1, pageSize);
	const from = (page - 1) * size + 1;
	return { from, to: Math.min(total, from + size - 1) };
}

/** 数据量变化后的页码与页数；`reset` 为真时强制回到第 1 页。 */
export function nextPagingState(
	total: number,
	pageSize: number,
	currentPage: number,
	reset: boolean,
): { page: number; pageCount: number } {
	const pageCount = pageCountOf(total, pageSize);
	return {
		page: reset ? 1 : clampPage(currentPage, pageCount),
		pageCount,
	};
}

export function renderPager(
	host: HTMLElement,
	opts: {
		labels: PagerLabels;
		pageSize: number;
		onGo(page: number): void;
	},
): PagerControls {
	host.addClass("ioto-card-pager");
	let current = 1;
	let total = 0;
	const prev = host.createEl("button", {
		cls: "clickable-icon ioto-card-pager-btn",
		attr: {
			type: "button",
			"aria-label": opts.labels.prev,
			title: opts.labels.prev,
		},
	});
	setIcon(prev, "chevron-left");
	const info = host.createDiv({ cls: "ioto-card-pager-info" });
	const next = host.createEl("button", {
		cls: "clickable-icon ioto-card-pager-btn",
		attr: {
			type: "button",
			"aria-label": opts.labels.next,
			title: opts.labels.next,
		},
	});
	setIcon(next, "chevron-right");
	prev.addEventListener("click", () => opts.onGo(current - 1));
	next.addEventListener("click", () => opts.onGo(current + 1));
	return {
		update(page, pageCount, nextTotal) {
			current = page;
			total = nextTotal;
			prev.disabled = page <= 1;
			next.disabled = page >= pageCount;
			const { from, to } = pageBounds(page, opts.pageSize, total);
			info.setText(
				`${opts.labels.page(page, pageCount)} · ${opts.labels.range(from, to, total)}`,
			);
		},
	};
}

export interface PagedListOptions<T> {
	/** 本质是卡片正文（滚动容器），切页后把 scrollTop 归零。 */
	host: HTMLElement;
	items: readonly T[];
	pageSize: number;
	initialPage?: number;
	tagName?: "ul" | "div";
	listClass?: string;
	labels: PagerLabels;
	renderItem(item: T, index: number): HTMLElement;
	onPageChange?(page: number): void;
}

export function renderPagedList<T>(
	opts: PagedListOptions<T>,
): PagedListHandle<T> {
	const size = Math.max(1, opts.pageSize);
	let items = opts.items;
	let pageCount = pageCountOf(items.length, size);
	let page = clampPage(opts.initialPage ?? 1, pageCount);
	const listEl = opts.host.createEl(opts.tagName ?? "ul", { cls: opts.listClass });
	// 分页条常驻：过滤后页数可能降到 1，再清空过滤又需要它重新出现。
	const pagerEl = opts.host.createDiv({ cls: "ioto-card-pager" });
	pagerEl.toggleClass("is-hidden", pageCount <= 1);
	const controls = renderPager(pagerEl, {
		labels: opts.labels,
		pageSize: size,
		onGo: (target) => goTo(target),
	});
	const draw = (): void => {
		listEl.empty();
		const start = (page - 1) * size;
		items
			.slice(start, start + size)
			.forEach((item, index) =>
				listEl.appendChild(opts.renderItem(item, start + index)),
			);
		controls.update(page, pageCount, items.length);
	};
	const goTo = (target: number): void => {
		const next = clampPage(target, pageCount);
		if (next === page) return;
		page = next;
		draw();
		opts.host.scrollTop = 0;
		opts.onPageChange?.(page);
	};
	const setItems = (
		next: readonly T[],
		setOptions: { resetPage?: boolean } = {},
	): void => {
		items = next;
		const sizing = nextPagingState(
			items.length,
			size,
			page,
			setOptions.resetPage ?? false,
		);
		page = sizing.page;
		pageCount = sizing.pageCount;
		pagerEl.toggleClass("is-hidden", pageCount <= 1);
		draw();
		opts.host.scrollTop = 0;
		if (setOptions.resetPage) opts.onPageChange?.(page);
	};
	draw();
	return {
		get page() {
			return page;
		},
		get pageCount() {
			return pageCount;
		},
		goTo,
		setItems,
	};
}
