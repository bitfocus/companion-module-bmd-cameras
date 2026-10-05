import { Agent, fetch, WebSocket, type Dispatcher, type RequestInit, type Response } from 'undici'
import type { ModuleConfig } from './config.js'

const insecureHttpsDispatcher = new Agent({ connect: { rejectUnauthorized: false } })

export type CameraWebSocket = {
	send: (data: string) => void
	close: () => void
	onopen: (() => void) | null
	onclose: (() => void) | null
	onerror: ((err: unknown) => void) | null
	onmessage: ((event: { data: string }) => void) | null
}

export function getCameraDispatcher(config: ModuleConfig): Dispatcher | undefined {
	return config.useHttps && config.allowInsecureHttps ? insecureHttpsDispatcher : undefined
}

export async function cameraFetch(config: ModuleConfig, input: string | URL, init?: RequestInit): Promise<Response> {
	const dispatcher = getCameraDispatcher(config)
	if (dispatcher) return await fetch(input, { ...init, dispatcher })
	return (await globalThis.fetch(input, init as globalThis.RequestInit)) as unknown as Response
}

export function cameraWebSocket(config: ModuleConfig, url: string): CameraWebSocket | undefined {
	const dispatcher = getCameraDispatcher(config)
	if (dispatcher) return new WebSocket(url, { dispatcher }) as unknown as CameraWebSocket

	const WebSocketCtor = (globalThis as unknown as { WebSocket?: new (url: string) => CameraWebSocket }).WebSocket
	return WebSocketCtor ? new WebSocketCtor(url) : undefined
}
