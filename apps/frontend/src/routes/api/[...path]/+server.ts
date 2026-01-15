import type { RequestHandler } from './$types';
import { getBackendUrl } from '@totem/utils';

const backendUrl = getBackendUrl();

/**
 * Proxy handler for API calls to backend
 * Matches: /api/*, /webhook
 * Routes through: backend:3000
 */
async function proxyRequest(
	method: string,
	pathname: string,
	query: string,
	request: Request
): Promise<Response> {
	// Strip /api prefix and rebuild path
	const backendPath = pathname.startsWith('/api/')
		? pathname
		: pathname === '/webhook'
			? '/api/webhook'
			: pathname;

	const url = `${backendUrl}${backendPath}${query}`;

	try {
		const body = request.method !== 'GET' && request.method !== 'HEAD'
			? await request.text()
			: undefined;

		const response = await fetch(url, {
			method,
			headers: {
				...Object.fromEntries(request.headers),
				'x-forwarded-for': request.headers.get('x-forwarded-for') || 'unknown',
				'x-forwarded-proto': 'https'
			},
			...(body && { body })
		});

		return new Response(response.body, {
			status: response.status,
			headers: response.headers
		});
	} catch (error) {
		console.error(`[proxy] ${method} ${pathname} failed:`, error);
		return new Response(JSON.stringify({ error: 'Service unavailable' }), {
			status: 503,
			headers: { 'content-type': 'application/json' }
		});
	}
}

export const GET: RequestHandler = async ({ url, request }) => {
	return proxyRequest('GET', url.pathname, url.search, request);
};

export const POST: RequestHandler = async ({ url, request }) => {
	return proxyRequest('POST', url.pathname, url.search, request);
};

export const PATCH: RequestHandler = async ({ url, request }) => {
	return proxyRequest('PATCH', url.pathname, url.search, request);
};

export const DELETE: RequestHandler = async ({ url, request }) => {
	return proxyRequest('DELETE', url.pathname, url.search, request);
};

export const PUT: RequestHandler = async ({ url, request }) => {
	return proxyRequest('PUT', url.pathname, url.search, request);
};
