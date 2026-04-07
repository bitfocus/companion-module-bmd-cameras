import { type SomeCompanionConfigField } from '@companion-module/base'
import {
	DEFAULT_HTTP_PORT,
	DEFAULT_HTTPS_PORT,
	DEFAULT_POLL_INTERVAL_MS,
	DEFAULT_REQUEST_TIMEOUT_MS,
} from './constants.js'

export type FetchMode = 'eager' | 'lazy'
export type EndpointHandling = 'probe' | 'show'

export interface ModuleConfig {
	host: string
	port: number
	useHttps: boolean
	fetchMode: FetchMode
	endpointHandling: EndpointHandling
	pollIntervalMs: number
	requestTimeoutMs: number
}

export function GetConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'textinput',
			id: 'host',
			label: 'Camera host or IP',
			width: 6,
			default: '127.0.0.1',
		},
		{
			type: 'number',
			id: 'port',
			label: 'Port',
			width: 2,
			min: 1,
			max: 65535,
			default: DEFAULT_HTTP_PORT,
		},
		{
			type: 'checkbox',
			id: 'useHttps',
			label: 'Use HTTPS',
			width: 4,
			default: false,
		},
		{
			type: 'dropdown',
			id: 'fetchMode',
			label: 'Data fetch mode',
			width: 6,
			default: 'eager',
			choices: [
				{ id: 'eager', label: 'Eager — fetch all data on connect' },
				{ id: 'lazy', label: 'Lazy — fetch only when subscribed' },
			],
		},
		{
			type: 'dropdown',
			id: 'endpointHandling',
			label: 'Unsupported endpoint handling',
			width: 6,
			default: 'probe',
			choices: [
				{ id: 'probe', label: 'Probe and hide unsupported (501)' },
				{ id: 'show', label: 'Show all endpoints' },
			],
		},
		{
			type: 'number',
			id: 'pollIntervalMs',
			label: 'Polling interval (ms)',
			width: 6,
			min: 250,
			max: 60000,
			default: DEFAULT_POLL_INTERVAL_MS,
		},
		{
			type: 'number',
			id: 'requestTimeoutMs',
			label: 'Request timeout (ms)',
			width: 6,
			min: 500,
			max: 120000,
			default: DEFAULT_REQUEST_TIMEOUT_MS,
		},
	]
}

export function NormalizeConfig(config: ModuleConfig): ModuleConfig {
	const useHttps = Boolean(config.useHttps)
	const fallbackPort = useHttps ? DEFAULT_HTTPS_PORT : DEFAULT_HTTP_PORT
	return {
		host: String(config.host || '').trim(),
		port: Number.isFinite(config.port) && config.port > 0 ? Math.trunc(config.port) : fallbackPort,
		useHttps,
		fetchMode: config.fetchMode === 'lazy' ? 'lazy' : 'eager',
		endpointHandling: config.endpointHandling === 'show' ? 'show' : 'probe',
		pollIntervalMs:
			Number.isFinite(config.pollIntervalMs) && config.pollIntervalMs >= 250
				? Math.trunc(config.pollIntervalMs)
				: DEFAULT_POLL_INTERVAL_MS,
		requestTimeoutMs:
			Number.isFinite(config.requestTimeoutMs) && config.requestTimeoutMs >= 500
				? Math.trunc(config.requestTimeoutMs)
				: DEFAULT_REQUEST_TIMEOUT_MS,
	}
}
