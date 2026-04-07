import { API_BASE_PATH } from '../constants.js'
import type { ModuleConfig } from '../config.js'
import type { HttpMethod } from '../types.js'

type RawWs = {
	send: (data: string) => void
	close: () => void
	onopen: (() => void) | null
	onclose: (() => void) | null
	onerror: ((err: unknown) => void) | null
	onmessage: ((event: { data: string }) => void) | null
}

type WsCtor = new (url: string) => RawWs

export interface CameraClientOptions {
	config: ModuleConfig
	onState: (property: string, value: unknown, source: 'rest' | 'ws' | 'poll') => void
	onLog: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void
}

export class CameraClient {
	private config: ModuleConfig
	private readonly onState: CameraClientOptions['onState']
	private readonly onLog: CameraClientOptions['onLog']
	private ws: RawWs | undefined
	private wsConnected = false
	private pollTimer: NodeJS.Timeout | undefined
	private reconnectTimer: NodeJS.Timeout | undefined
	private reconnectAttempt = 0
	private readonly subscribedProperties = new Set<string>()
	private wsPath: string | undefined

	constructor(options: CameraClientOptions) {
		this.config = options.config
		this.onState = options.onState
		this.onLog = options.onLog
	}

	updateConfig(config: ModuleConfig): void {
		this.config = config
	}

	setWsPath(path: string | undefined): void {
		this.wsPath = path
	}

	async start(): Promise<void> {
		this.stop()
		if (this.wsPath) await this.connectWebSocket()
		this.startPolling()
	}

	stop(): void {
		if (this.pollTimer) {
			clearInterval(this.pollTimer)
			this.pollTimer = undefined
		}
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer)
			this.reconnectTimer = undefined
		}
		if (this.ws) {
			this.ws.close()
			this.ws = undefined
		}
		this.wsConnected = false
		this.reconnectAttempt = 0
	}

	private protocol(): 'http' | 'https' {
		return this.config.useHttps ? 'https' : 'http'
	}

	private wsProtocol(): 'ws' | 'wss' {
		return this.config.useHttps ? 'wss' : 'ws'
	}

	getBaseUrl(): string {
		return `${this.protocol()}://${this.config.host}:${this.config.port}${API_BASE_PATH}`
	}

	private async connectWebSocket(): Promise<void> {
		if (!this.wsPath) return

		const WebSocketCtor = (globalThis as unknown as { WebSocket?: WsCtor }).WebSocket
		if (!WebSocketCtor) {
			this.onLog('warn', 'Global WebSocket implementation unavailable, using polling only')
			return
		}

		const url = `${this.wsProtocol()}://${this.config.host}:${this.config.port}${this.wsPath}`
		try {
			await new Promise<void>((resolve: () => void, reject: (err: Error) => void) => {
				const ws = new WebSocketCtor(url)
				let settled = false
				const timeout = setTimeout(() => {
					if (!settled) {
						settled = true
						ws.close()
						reject(new Error('timeout'))
					}
				}, this.config.requestTimeoutMs)

				ws.onopen = () => {
					if (settled) return
					settled = true
					clearTimeout(timeout)
					this.ws = ws
					this.wsConnected = true
					this.reconnectAttempt = 0
					this.attachWsHandlers(ws)
					this.onLog('info', `WebSocket connected at ${this.wsPath}`)
					this.refreshWebSocketSubscriptions()
					resolve()
				}
				ws.onerror = (err: unknown) => {
					if (settled) return
					settled = true
					clearTimeout(timeout)
					reject(err instanceof Error ? err : new Error('websocket error'))
				}
			})
		} catch {
			this.ws = undefined
			this.wsConnected = false
			this.onLog('warn', 'WebSocket unavailable, using polling fallback')
			this.scheduleReconnect()
		}
	}

	private attachWsHandlers(ws: RawWs): void {
		ws.onmessage = (message: { data: string }) => {
			try {
				const data = JSON.parse(message.data)
				const type = data?.type as string | undefined
				const payload = data?.data as Record<string, unknown> | undefined
				if (!payload) return

				if (type === 'event' && payload.action === 'propertyValueChanged' && typeof payload.property === 'string') {
					this.onState(payload.property, payload.value, 'ws')
					return
				}

				if (type === 'response' && payload.action === 'subscribe' && payload.success === true) {
					// Subscribe responses include current values — store them
					const values = payload.values as Record<string, unknown> | undefined
					if (values) {
						for (const [prop, val] of Object.entries(values)) {
							this.onState(prop, val, 'ws')
						}
					}
					return
				}

				if (type === 'response' && payload.success === false) {
					const errMsg = (payload.errorMessage as string) ?? 'unknown error'
					// Unsubscribe properties the camera doesn't support
					const match = errMsg.match(/Cannot subscribe to unknown property '([^']+)'/)
					if (match) {
						this.subscribedProperties.delete(match[1])
						this.onLog('debug', `Camera does not support subscription: ${match[1]}`)
					} else {
						this.onLog('warn', `WebSocket error response: ${errMsg}`)
					}
				}
			} catch (error) {
				this.onLog('warn', `WebSocket parse error: ${error instanceof Error ? error.message : String(error)}`)
			}
		}

		ws.onclose = () => {
			this.wsConnected = false
			this.ws = undefined
			this.scheduleReconnect()
		}

		ws.onerror = (err: unknown) => {
			// ErrorEvent objects don't stringify well — extract the message if available
			const msg =
				err instanceof Error
					? err.message
					: typeof err === 'object' && err !== null && 'message' in err
						? String((err as { message: unknown }).message)
						: 'unknown error'
			this.onLog('debug', `WebSocket error event: ${msg}`)
		}
	}

	private scheduleReconnect(): void {
		if (!this.wsPath) return
		if (this.reconnectTimer) return
		const delay = Math.min(30000, 1000 * 2 ** Math.min(this.reconnectAttempt, 5))
		this.reconnectAttempt += 1
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = undefined
			void this.connectWebSocket()
		}, delay)
		this.onLog('debug', `WebSocket reconnect scheduled in ${delay}ms`)
	}

	private startPolling(): void {
		const interval = Math.max(250, this.config.pollIntervalMs)
		this.pollTimer = setInterval(() => {
			void this.pollSubscribedProperties()
		}, interval)
	}

	private async pollSubscribedProperties(): Promise<void> {
		if (this.wsConnected) return
		const properties = [...this.subscribedProperties]
		if (properties.length === 0) return

		for (const property of properties) {
			try {
				const value = await this.request('GET', property)
				this.onState(property, value, 'poll')
			} catch (error) {
				this.onLog('debug', `Polling failed for ${property}: ${error instanceof Error ? error.message : String(error)}`)
			}
		}
	}

	private refreshWebSocketSubscriptions(): void {
		for (const property of this.subscribedProperties) this.sendSubscribe(property)
	}

	private sendSubscribe(property: string): void {
		if (!this.ws || !this.wsConnected) return
		this.ws.send(
			JSON.stringify({
				type: 'request',
				data: { action: 'subscribe', properties: [property] },
			}),
		)
	}

	private sendUnsubscribe(property: string): void {
		if (!this.ws || !this.wsConnected) return
		this.ws.send(
			JSON.stringify({
				type: 'request',
				data: { action: 'unsubscribe', properties: [property] },
			}),
		)
	}

	ensurePropertySubscription(property: string): void {
		this.subscribedProperties.add(property)
		this.sendSubscribe(property)
	}

	removePropertySubscription(property: string): void {
		this.subscribedProperties.delete(property)
		this.sendUnsubscribe(property)
	}

	async request(method: HttpMethod, path: string, body?: unknown): Promise<unknown> {
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs)
		try {
			const url = new URL(`${this.getBaseUrl()}${path}`)
			const response = await fetch(url, {
				method,
				headers: {
					Accept: 'application/json',
					...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
				},
				body: body !== undefined ? JSON.stringify(body) : undefined,
				signal: controller.signal,
			})

			if (response.status === 204) return { ok: true }
			if (!response.ok) {
				const bodyText = await response.text()
				throw new Error(`HTTP ${response.status}: ${bodyText}`)
			}

			const contentType = response.headers.get('content-type') || ''
			if (contentType.includes('application/json')) {
				return await response.json()
			}
			return await response.text()
		} finally {
			clearTimeout(timeout)
		}
	}
}
