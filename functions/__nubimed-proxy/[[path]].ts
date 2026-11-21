/**
 * Cloudflare Pages Function: same-origin proxy to the Nubimed portal (AD-7).
 * Mirrors the Vite dev proxy in `astro.config.mjs` (prefix strip + Referer rewrite).
 *
 * Not an open proxy: strict method + path allowlist, fail-closed without clinic id.
 * NEVER log bodies, query strings or cookies (patient data, REQ-21).
 *
 * Unverified against Cloudflare docs (validate on preview):
 *  (a) `[[path]]` catch-all routing in git deploy;
 *  (b) dashboard variables reach `context.env` at runtime;
 *  (c) runtime gives an already-decompressed body (so Content-Encoding/Length are not copied);
 *  (d) Cloudflare egress IPs are not blocked by the vendor WAF.
 */

interface ProxyContext {
	request: Request;
	env: Record<string, string | undefined>;
}

const PREFIX = '/__nubimed-proxy';
const DEFAULT_VENDOR = 'https://portal.clinicaenlanube.com';

const FORWARD_REQUEST_HEADERS = ['accept', 'accept-language', 'content-type', 'x-requested-with', 'x-csrf-token', 'cookie'];

function plain(status: number, extra?: Record<string, string>): Response {
	return new Response(null, {
		status,
		headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', ...extra },
	});
}

function resolveVendor(raw: string | undefined): string | null {
	try {
		const u = new URL((raw?.trim() || DEFAULT_VENDOR).replace(/\/+$/, ''));
		return u.protocol === 'https:' ? u.origin : null;
	} catch {
		return null;
	}
}

function isAllowed(method: string, path: string, search: URLSearchParams, id: string): boolean {
	const base = `/clinicas/${id}/cita_peticiones`;
	if (method === 'GET') {
		if (path === `${base}/widget` || path === `${base}/huecos_agenda` || path === `${base}/new`) return true;
		if (path === '/ajax/obtener_clinica_tratamientos') return search.get('clinica_id') === id;
		return false;
	}
	if (method === 'POST') return path === base;
	return false;
}

export const onRequest = async (context: ProxyContext): Promise<Response> => {
	const { request, env } = context;

	const rawId = env.PUBLIC_NUBIMED_CLINICA_ID?.trim() ?? '';
	if (!/^[1-9]\d*$/.test(rawId)) return plain(503);
	const vendor = resolveVendor(env.PUBLIC_NUBIMED_VENDOR_ORIGIN);
	if (!vendor) return plain(503);

	const url = new URL(request.url);
	if (!url.pathname.startsWith(PREFIX)) return plain(404);
	const path = url.pathname.slice(PREFIX.length) || '/';
	const method = request.method.toUpperCase();

	// Path check first (404), then method (405); vendor is never called on reject.
	const pathKnown = isAllowed('GET', path, url.searchParams, rawId) || isAllowed('POST', path, url.searchParams, rawId);
	if (!pathKnown) return plain(404);
	if (!isAllowed(method, path, url.searchParams, rawId)) return plain(405, { Allow: 'GET, POST' });

	const headers = new Headers();
	for (const name of FORWARD_REQUEST_HEADERS) {
		const v = request.headers.get(name);
		if (v) headers.set(name, v);
	}
	headers.set('Referer', `${vendor}/clinicas/${rawId}/cita_peticiones/widget`);
	if (method === 'POST') headers.set('Origin', vendor);

	let upstream: Response;
	try {
		upstream = await fetch(`${vendor}${path}${url.search}`, {
			method,
			headers,
			body: method === 'POST' ? request.body : undefined,
			redirect: 'manual',
		});
	} catch {
		return plain(502);
	}

	const out = new Headers({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
	const ct = upstream.headers.get('content-type');
	if (ct) out.set('Content-Type', ct);

	for (const cookie of upstream.headers.getSetCookie()) {
		out.append('Set-Cookie', cookie.replace(/;\s*Domain=[^;]*/gi, ''));
	}

	const location = upstream.headers.get('location');
	if (location) {
		// Absolute vendor URLs and root-relative paths stay inside the proxy; anything else passes through.
		const rewritten = location.startsWith(vendor)
			? `${PREFIX}${location.slice(vendor.length) || '/'}`
			: location.startsWith('/') && !location.startsWith('//')
				? `${PREFIX}${location}`
				: location;
		out.set('Location', rewritten);
	}

	return new Response(upstream.body, { status: upstream.status, headers: out });
};
