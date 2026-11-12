export interface PagerLabels {
	prev: string;
	next: string;
	page: (page: number, pageCount: number) => string;
	range: (from: number, to: number, total: number) => string;
}

export interface PagerControls {
	update(page: number, pageCount: number): void;
}

export interface PagedListHandle {
	readonly page: number;
	readonly pageCount: number;
	goTo(page: number): void;
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

export function renderPager(
	host: HTMLElement,
	opts: {
		labels: PagerLabels;
		total: number;
		pageSize: number;
		onGo(page: number): void;
	},
): PagerControls {
	host.addClass("ioto-card-pager");
	let current = 1;
	const prev = host.createEl("button", {
		cls: "ioto-card-pager-btn",
		text: "‹",
		attr: { type: "button", "aria-label": opts.labels.prev },
	});
	const info = host.createDiv({ cls: "ioto-card-pager-info" });
	const next = host.createEl("button", {
		cls: "ioto-card-pager-btn",
		text: "›",
		attr: { type: "button", "aria-label": opts.labels.next },
	});
	prev.addEventListener("click", () => opts.onGo(current - 1));
	next.addEventListener("click", () => opts.onGo(current + 1));
	return {
		update(page, pageCount) {
			current = page;
			prev.disabled = page <= 1;
			next.disabled = page >= pageCount;
			const { from, to } = pageBounds(page, opts.pageSize, opts.total);
			info.setText(
				`${opts.labels.page(page, pageCount)} · ${opts.labels.range(from, to, opts.total)}`,
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

export function renderPagedList<T>(opts: PagedListOptions<T>): PagedListHandle {
	const size = Math.max(1, opts.pageSize);
	const pageCount = pageCountOf(opts.items.length, size);
	let page = clampPage(opts.initialPage ?? 1, pageCount);
	const listEl = opts.host.createEl(opts.tagName ?? "ul", { cls: opts.listClass });
	const pagerEl =
		pageCount > 1 ? opts.host.createDiv({ cls: "ioto-card-pager" }) : null;
	let controls: PagerControls | null = null;
	const draw = (): void => {
		listEl.empty();
		const start = (page - 1) * size;
		opts.items
			.slice(start, start + size)
			.forEach((item, index) =>
				listEl.appendChild(opts.renderItem(item, start + index)),
			);
		controls?.update(page, pageCount);
	};
	const goTo = (target: number): void => {
		const next = clampPage(target, pageCount);
		if (next === page) return;
		page = next;
		draw();
		opts.host.scrollTop = 0;
		opts.onPageChange?.(page);
	};
	if (pagerEl) {
		controls = renderPager(pagerEl, {
			labels: opts.labels,
			total: opts.items.length,
			pageSize: size,
			onGo: goTo,
		});
	}
	draw();
	return {
		get page() {
			return page;
		},
		pageCount,
		goTo,
	};
}
