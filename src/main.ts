// ── Config ────────────────────────────────────────────────────────────────────
const API_URL = 'https://super-fortnight-be.onrender.com/api';
const WORKSPACE = 'johnenterprise';
const COVER_BASE = 'https://covers.openlibrary.org/b/id/';

// ── Types ─────────────────────────────────────────────────────────────────────
interface RawUser {
	user_id?: string;
	id?: string;
	email?: string;
	name?: string;
	avatar?: string;
	attributes?: Record<string, unknown>;
	company?: Record<string, unknown>;
}

interface UserContext {
	user_id: string;
	email: string;
	name: string;
	avatar?: string;
	attributes: Record<string, unknown>;
	company: Record<string, unknown>;
}

interface OpenLibraryDoc {
	key?: string;
	title?: string;
	author_name?: string[];
	cover_i?: number;
}

interface OpenLibraryResponse {
	docs?: OpenLibraryDoc[];
}

interface AuthResponse {
	token: string;
	userContext: RawUser;
	error?: string;
}

interface MeResponse {
	userContext: RawUser;
}

interface Survey {
	surveyId: string;
}

interface SurveyWidget {
	destroy(): void;
}

interface LiveChatWidgetOptions {
	position: string;
	theme: string;
	welcomeMessage: string;
	enableHelp: boolean;
	enableChangelog: boolean;
	feedbackBoardName: string;
	feedbackUrl: string;
	changelogUrl: string;
	helpUrl: string;
	roadmapUrl: string;
}

interface Product7SDK {
	init(): Promise<void>;
	destroy(): void;
	on(event: string, cb: (payload: unknown) => void): void;
	identify(user: UserContext): Promise<void>;
	createLiveChatWidget(opts: LiveChatWidgetOptions): { mount(): void };
	getActiveSurveys(opts: { includeEligibility: boolean }): Promise<Survey[]>;
	showSurveyById(
		id: string,
		opts: {
			position: string;
			respondentId: string | null;
			email: string | null;
			onSubmit: () => void;
			onDismiss: () => void;
		}
	): Promise<SurveyWidget>;
}

// ── State ─────────────────────────────────────────────────────────────────────
let currentUser: UserContext | null = null;
let product7SDK: Product7SDK | null = null;
let liveChatWidget: { mount(): void } | null = null;
let surveyWidget: SurveyWidget | null = null;
let isRegister = false;
let product7Initialized = false;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const booksGrid = document.getElementById('booksGrid') as HTMLDivElement;
const sectionTitle = document.getElementById(
	'sectionTitle'
) as HTMLHeadingElement;
const sectionCount = document.getElementById('sectionCount') as HTMLSpanElement;
const searchInput = document.getElementById('searchInput') as HTMLInputElement;
const searchBtn = document.getElementById('searchBtn') as HTMLButtonElement;
const loginBtn = document.getElementById('loginBtn') as HTMLButtonElement;
const registerBtn = document.getElementById('registerBtn') as HTMLButtonElement;
const userInfo = document.getElementById('userInfo') as HTMLDivElement;
const modal = document.getElementById('authModal') as HTMLDivElement;
const modalTitle = document.getElementById('modalTitle') as HTMLHeadingElement;
const nameGroup = document.getElementById('nameGroup') as HTMLDivElement;
const nameInput = document.getElementById('nameInput') as HTMLInputElement;
const emailInput = document.getElementById('emailInput') as HTMLInputElement;
const passwordInput = document.getElementById(
	'passwordInput'
) as HTMLInputElement;
const errorMsg = document.getElementById('errorMsg') as HTMLDivElement;
const submitBtn = document.getElementById('submitBtn') as HTMLButtonElement;
const switchText = document.getElementById('switchText') as HTMLSpanElement;
const switchLink = document.getElementById('switchLink') as HTMLAnchorElement;

// ── Button loading helper ─────────────────────────────────────────────────────
function setButtonLoading(
	btn: HTMLButtonElement,
	loading: boolean,
	text = ''
): void {
	if (loading) {
		btn.disabled = true;
		btn.dataset.originalText = btn.textContent ?? '';
		btn.innerHTML = `<span class="btn-spinner"></span>${text}`;
	} else {
		btn.disabled = false;
		btn.textContent = btn.dataset.originalText ?? '';
	}
}

// ── Books ─────────────────────────────────────────────────────────────────────
function genPrice(key: string): string {
	let h = 0;
	for (let i = 0; i < key.length; i++)
		h = (h * 31 + key.charCodeAt(i)) & 0xffffffff;
	return (8.99 + (Math.abs(h) % 2100) / 100).toFixed(2);
}

function renderBooks(books: OpenLibraryDoc[]): void {
	if (!books.length) {
		booksGrid.innerHTML =
			'<div class="grid-msg">No books found — try a different search.</div>';
		return;
	}
	booksGrid.innerHTML = books
		.map((b) => {
			const title = b.title ?? 'Untitled';
			const authors = b.author_name
				? b.author_name.slice(0, 2).join(', ')
				: 'Unknown Author';
			const coverId = b.cover_i;
			const key = b.key ?? title;
			const safeTitle = title.replace(/'/g, '&#39;');
			const cover = coverId
				? `<img class="book-cover" src="${COVER_BASE}${coverId}-M.jpg" alt="${title}" loading="lazy"
           onerror="this.outerHTML='<div class=book-cover-placeholder><span>${safeTitle}</span></div>'" />`
				: `<div class="book-cover-placeholder"><span>${title}</span></div>`;
			return `
      <div class="book-card">
        ${cover}
        <div class="book-meta">
          <div class="book-title">${title}</div>
          <div class="book-author">${authors}</div>
        </div>
        <div class="book-footer">
          <span class="book-price">$${genPrice(key)}</span>
          <button class="add-btn" data-title="${safeTitle}">Add to Cart</button>
        </div>
      </div>`;
		})
		.join('');

	booksGrid.querySelectorAll<HTMLButtonElement>('.add-btn').forEach((btn) => {
		btn.addEventListener('click', () => {
			if (!currentUser) {
				openModal(false);
				return;
			}
			const t = btn.dataset.title ?? 'this book';
			setButtonLoading(btn, true, 'Adding…');
			setTimeout(() => {
				setButtonLoading(btn, false);
				alert(`"${t}" added to cart!`);
			}, 600);
		});
	});
}

async function fetchBooks(query: string, label: string): Promise<void> {
	booksGrid.innerHTML = '<div class="grid-msg">Loading books…</div>';
	sectionTitle.textContent = label;
	sectionCount.textContent = '';
	try {
		const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=20&fields=key,title,author_name,cover_i&lang=eng`;
		const res = await fetch(url);
		const data = (await res.json()) as OpenLibraryResponse;
		const books = (data.docs ?? []).filter((b) => b.cover_i).slice(0, 16);
		sectionCount.textContent = books.length ? `${books.length} titles` : '';
		renderBooks(books);
	} catch {
		booksGrid.innerHTML =
			'<div class="grid-msg">Failed to load — check your connection and try again.</div>';
	}
}

searchBtn.addEventListener('click', () => {
	const q = searchInput.value.trim();
	if (q) fetchBooks(q, `"${q}"`);
});
searchInput.addEventListener('keydown', (e: KeyboardEvent) => {
	if (e.key === 'Enter') searchBtn.click();
});

// ── Auth modal ────────────────────────────────────────────────────────────────
function syncModal(): void {
	if (isRegister) {
		modalTitle.textContent = 'Create account';
		submitBtn.textContent = 'Register';
		nameGroup.style.display = 'flex';
		switchText.textContent = 'Already have an account?';
		switchLink.textContent = 'Log in';
	} else {
		modalTitle.textContent = 'Log in';
		submitBtn.textContent = 'Log in';
		nameGroup.style.display = 'none';
		switchText.textContent = "Don't have an account?";
		switchLink.textContent = 'Register';
	}
}

function openModal(reg: boolean): void {
	isRegister = reg;
	syncModal();
	errorMsg.textContent = '';
	(document.getElementById('authForm') as HTMLFormElement).reset();
	modal.classList.add('open');
}

function closeModal(): void {
	modal.classList.remove('open');
}

function syncNav(): void {
	if (currentUser) {
		userInfo.style.display = 'block';
		userInfo.textContent = currentUser.name || currentUser.email?.split('@')[0];
		loginBtn.textContent = 'Sign out';
		registerBtn.style.display = 'none';
	} else {
		userInfo.style.display = 'none';
		loginBtn.textContent = 'Log in';
		registerBtn.style.display = '';
	}
}

loginBtn.addEventListener('click', () => {
	currentUser ? logout() : openModal(false);
});
registerBtn.addEventListener('click', () => openModal(true));
document.getElementById('modalClose')!.addEventListener('click', closeModal);
document.getElementById('modalOverlay')!.addEventListener('click', closeModal);
switchLink.addEventListener('click', () => {
	isRegister = !isRegister;
	syncModal();
	errorMsg.textContent = '';
});

// ── Auth form submit ──────────────────────────────────────────────────────────
(document.getElementById('authForm') as HTMLFormElement).addEventListener(
	'submit',
	async (e: Event) => {
		e.preventDefault();
		errorMsg.textContent = '';

		const email = emailInput.value.trim();
		const password = passwordInput.value;
		const name = nameInput.value.trim();

		if (password.length < 6) {
			errorMsg.textContent = 'Password must be at least 6 characters.';
			return;
		}

		setButtonLoading(
			submitBtn,
			true,
			isRegister ? 'Creating account…' : 'Signing in…'
		);

		const endpoint = isRegister ? '/register' : '/login';
		const body = isRegister ? { email, password, name } : { email, password };

		try {
			const res = await fetch(API_URL + endpoint, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});
			const data = (await res.json()) as AuthResponse;

			if (!res.ok) {
				errorMsg.textContent = data.error ?? 'Authentication failed.';
				setButtonLoading(submitBtn, false);
				return;
			}

			localStorage.setItem('authToken', data.token);
			currentUser = normalizeUserContext(data.userContext);
			syncNav();
			closeModal();

			await identifyUser(currentUser);
			await checkAndShowActiveSurvey();
		} catch {
			errorMsg.textContent = 'Network error. Please try again.';
		} finally {
			setButtonLoading(submitBtn, false);
		}
	}
);

// ── Product7 helpers ──────────────────────────────────────────────────────────
function normalizeUserContext(user: RawUser): UserContext {
	const ctx: UserContext = {
		user_id: user?.user_id ?? user?.id ?? 'guest',
		email: user?.email ?? '',
		name: user?.name ?? 'Guest',
		attributes: {
			plan: 'free',
			role: 'customer',
			signup_source: 'web',
			app_version: '1.0.0',
			...(user?.attributes ?? {}),
		},
		company: {
			name: 'Folio Books',
			monthly_spend: 0,
			...(user?.company ?? {}),
		},
	};
	if (user?.avatar) ctx.avatar = user.avatar;
	return ctx;
}

function getProduct7BaseUrls(): Record<string, string> {
	const base = `https://${WORKSPACE}.product7.io`;
	return {
		feedbackUrl: `${base}/feedback`,
		changelogUrl: `${base}/changelog`,
		helpUrl: `${base}/help-docs`,
		roadmapUrl: `${base}/roadmap`,
	};
}

// ── SDK init ──────────────────────────────────────────────────────────────────
async function initSDK(): Promise<void> {
	if (product7SDK && product7Initialized) return;
	try {
		const SDK = await import('@product7/product7-js');
		product7SDK = new SDK.Product7({ workspace: WORKSPACE }) as unknown as Product7SDK;
		await product7SDK.init();
		product7Initialized = true;
		product7SDK.on('survey:suppressed', (payload: unknown) => {
			console.log('Survey suppressed:', payload);
		});
	} catch (err) {
		console.error('SDK init failed:', err);
	}
}

// ── Mount widgets ─────────────────────────────────────────────────────────────
async function mountWidgets(): Promise<void> {
	if (!product7SDK || !product7Initialized || liveChatWidget) return;
	const urls = getProduct7BaseUrls();
	try {
		liveChatWidget = product7SDK.createLiveChatWidget({
			feedbackBoardName: 'feature-requests',
			feedbackUrl: urls.feedbackUrl,
			changelogUrl: urls.changelogUrl,
			helpUrl: urls.helpUrl,
			roadmapUrl: urls.roadmapUrl,
		});
		liveChatWidget.mount();
	} catch (err) {
		console.error('Widget mount failed:', err);
	}
}

// ── Identify ──────────────────────────────────────────────────────────────────
async function identifyUser(user: UserContext): Promise<void> {
	if (!product7SDK || !product7Initialized) return;
	try {
		await product7SDK.identify(user);
	} catch (err) {
		console.error('identify failed:', err);
	}
}

// ── Survey ────────────────────────────────────────────────────────────────────
function destroySurveyWidget(): void {
	if (surveyWidget) {
		surveyWidget.destroy();
		surveyWidget = null;
	}
}

async function checkAndShowActiveSurvey(): Promise<void> {
	if (!product7SDK || !product7Initialized) return;
	const surveys = await product7SDK.getActiveSurveys({
		includeEligibility: true,
	});
	if (!Array.isArray(surveys) || !surveys.length) {
		destroySurveyWidget();
		return;
	}
	destroySurveyWidget();
	surveyWidget = await product7SDK.showSurveyById(surveys[0].surveyId, {
		position: 'center',
		respondentId: currentUser?.user_id ?? null,
		email: currentUser?.email ?? null,
		onSubmit: () => destroySurveyWidget(),
		onDismiss: () => destroySurveyWidget(),
	});
}

// ── Logout ────────────────────────────────────────────────────────────────────
async function logout(): Promise<void> {
	localStorage.removeItem('authToken');
	destroySurveyWidget();

	if (product7SDK) {
		product7SDK.destroy();
		product7SDK = null;
		liveChatWidget = null;
	}
	product7Initialized = false;
	currentUser = null;
	syncNav();

	await initSDK();
	await mountWidgets();
	await checkAndShowActiveSurvey();
}

// ── Auth check on load ────────────────────────────────────────────────────────
async function checkAuth(): Promise<void> {
	await initSDK();

	const token = localStorage.getItem('authToken');
	if (token) {
		setButtonLoading(loginBtn, true, 'Loading…');
		try {
			const res = await fetch(API_URL + '/me', {
				headers: { Authorization: `Bearer ${token}` },
			});
			if (res.ok) {
				const data = (await res.json()) as MeResponse;
				currentUser = normalizeUserContext(data.userContext);
				syncNav();
				await identifyUser(currentUser);
			} else {
				localStorage.removeItem('authToken');
				setButtonLoading(loginBtn, false);
			}
		} catch {
			localStorage.removeItem('authToken');
			setButtonLoading(loginBtn, false);
		}
	}

	await mountWidgets();
	await checkAndShowActiveSurvey();
}

// ── Init ──────────────────────────────────────────────────────────────────────
syncNav();
fetchBooks('subject:fiction', 'Popular Fiction');
checkAuth();
