import {
	combineRgb,
	type CompanionFeedbackBooleanEvent,
	type CompanionFeedbackDefinitions,
	type CompanionFeedbackInfo,
	type CompanionFeedbackValueEvent,
} from '@companion-module/base'
import type { ModuleInstance } from './main.js'
import type { DiscoveredEndpoint } from './types.js'
import { endpointOverrides } from './overrides.js'

function getValueByPath(input: unknown, path: string): unknown {
	if (!path) return input
	const parts = path.split('.').filter((part: string) => part.length > 0)
	let current: unknown = input
	for (const part of parts) {
		if (!current || typeof current !== 'object') return undefined
		current = (current as Record<string, unknown>)[part]
	}
	return current
}

function toJsonSafeValue(input: unknown): string | number | boolean | null | Record<string, unknown> | unknown[] {
	if (input === null || input === undefined) return null
	if (typeof input === 'string' || typeof input === 'number' || typeof input === 'boolean') return input
	if (Array.isArray(input)) return input.map(toJsonSafeValue)
	if (typeof input === 'object') {
		const output: Record<string, unknown> = {}
		for (const [key, value] of Object.entries(input as Record<string, unknown>)) output[key] = toJsonSafeValue(value)
		return output
	}
	return typeof input === 'symbol' ? input.toString() : JSON.stringify(input)
}

function endpointToFeedbackId(endpoint: DiscoveredEndpoint): string {
	return endpoint.path.replace(/^\//, '').replace(/\//g, '_')
}

export function buildFeedbacks(self: ModuleInstance, endpoints: DiscoveredEndpoint[]): CompanionFeedbackDefinitions {
	const definitions: CompanionFeedbackDefinitions = {}

	const subscribableEndpoints = endpoints.filter(
		(ep) => ep.subscribable && ep.methods.includes('GET') && !ep.unsupported,
	)

	if (subscribableEndpoints.length === 0) return definitions

	for (const endpoint of subscribableEndpoints) {
		const id = endpointToFeedbackId(endpoint)
		const override = endpointOverrides[endpoint.path]
		const domainLabel = endpoint.domain.charAt(0).toUpperCase() + endpoint.domain.slice(1)
		const name = override?.label ?? `${domainLabel}: ${endpoint.summary}`

		const fieldChoices: { id: string; label: string }[] = []
		if (endpoint.responseSchema?.properties) {
			for (const [key, prop] of Object.entries(endpoint.responseSchema.properties)) {
				fieldChoices.push({ id: key, label: prop.description ?? key })
			}
		}

		definitions[`${id}_equals`] = {
			type: 'boolean',
			name: `${name} equals`,
			description: `Check if ${endpoint.path} field equals a target value`,
			defaultStyle: {
				bgcolor: combineRgb(0, 120, 0),
				color: combineRgb(255, 255, 255),
			},
			options:
				fieldChoices.length > 0
					? [
							{
								id: 'fieldPath',
								type: 'dropdown',
								label: 'Field',
								default: fieldChoices[0]?.id ?? '',
								choices: fieldChoices,
							},
							{ id: 'target', type: 'textinput', label: 'Target value', default: '', useVariables: true },
						]
					: [
							{
								id: 'fieldPath',
								type: 'textinput',
								label: 'Field path (optional)',
								default: '',
								useVariables: true,
							},
							{ id: 'target', type: 'textinput', label: 'Target value', default: '', useVariables: true },
						],
			callback: (feedback: CompanionFeedbackBooleanEvent) => {
				self.feedbackSubscriptions.set(feedback.id, endpoint.path)
				self.client.ensurePropertySubscription(endpoint.path)

				const value = self.store.get(endpoint.path)
				const fieldPath = typeof feedback.options.fieldPath === 'string' ? feedback.options.fieldPath : ''
				const targetValue = typeof feedback.options.target === 'string' ? feedback.options.target : ''
				const extracted = getValueByPath(value, fieldPath)
				if (extracted === undefined || extracted === null) return targetValue === ''
				if (typeof extracted === 'string' || typeof extracted === 'number' || typeof extracted === 'boolean') {
					return String(extracted) === targetValue
				}
				return JSON.stringify(extracted) === targetValue
			},
			unsubscribe: (feedback: CompanionFeedbackInfo) => {
				self.feedbackSubscriptions.unset(feedback.id)
				if (!self.feedbackSubscriptions.hasProperty(endpoint.path)) {
					self.client.removePropertySubscription(endpoint.path)
				}
			},
		}

		definitions[`${id}_value`] = {
			type: 'value',
			name: `${name} value`,
			description: `Returns current value of ${endpoint.path}`,
			options:
				fieldChoices.length > 0
					? [
							{
								id: 'fieldPath',
								type: 'dropdown',
								label: 'Field',
								default: fieldChoices[0]?.id ?? '',
								choices: fieldChoices,
							},
						]
					: [
							{
								id: 'fieldPath',
								type: 'textinput',
								label: 'Field path (optional)',
								default: '',
								useVariables: true,
							},
						],
			callback: (feedback: CompanionFeedbackValueEvent) => {
				self.feedbackSubscriptions.set(feedback.id, endpoint.path)
				self.client.ensurePropertySubscription(endpoint.path)

				const value = self.store.get(endpoint.path)
				const fieldPath = typeof feedback.options.fieldPath === 'string' ? feedback.options.fieldPath : ''
				return toJsonSafeValue(getValueByPath(value, fieldPath)) as never
			},
			unsubscribe: (feedback: CompanionFeedbackInfo) => {
				self.feedbackSubscriptions.unset(feedback.id)
				if (!self.feedbackSubscriptions.hasProperty(endpoint.path)) {
					self.client.removePropertySubscription(endpoint.path)
				}
			},
		}
	}

	return definitions
}
