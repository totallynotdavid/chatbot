import type { RequestHandler } from './$types';
import { getBackendUrl } from '@totem/utils';

const backendUrl = getBackendUrl();

/**
 * Image proxy with caching
 * Routes: /static/* (developer requests)
 * To backend: /static/*
 */
export const GET: RequestHandler = async ({ params }) => {
	const imagePath = params.path || '';

	if (!imagePath) {
		return new Response('Not Found', { status: 404 });
	}

	try {
		const response = await fetch(`${backendUrl}/static/${imagePath}`, {
			method: 'GET'
		});

		if (!response.ok) {
			return new Response('Not Found', { status: 404 });
		}

		// Add caching headers (images are immutable by ID)
		const newResponse = new Response(response.body, {
			status: response.status,
			headers: new Headers(response.headers)
		});
		newResponse.headers.set('cache-control', 'public, max-age=604800, immutable');

		return newResponse;
	} catch (error) {
		console.error(`[static] GET /${imagePath} failed:`, error);
		return new Response('Service unavailable', { status: 503 });
	}
};
