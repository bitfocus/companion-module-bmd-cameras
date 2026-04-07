import type { CompanionVariableDefinition, CompanionVariableValues } from '@companion-module/base'
import type { ModuleInstance } from './main.js'
import type { DiscoveredEndpoint } from './types.js'
import { endpointOverrides } from './overrides.js'

function endpointToVariablePrefix(endpoint: DiscoveredEndpoint): string {
	return endpoint.path.replace(/^\//, '').replace(/\//g, '_')
}

function toStringValue(input: unknown): string {
	if (input === undefined || input === null) return ''
	if (typeof input === 'string') return input
	if (typeof input === 'number' || typeof input === 'boolean') return String(input)
	try {
		return JSON.stringify(input)
	} catch {
		return ''
	}
}

function getPathValue(obj: unknown, fieldPath: string): unknown {
	if (!fieldPath) return obj
	const parts = fieldPath.split('.').filter((p) => p.length > 0)
	let current: unknown = obj
	for (const part of parts) {
		if (!current || typeof current !== 'object') return undefined
		current = (current as Record<string, unknown>)[part]
	}
	return current
}

export function buildVariableDefinitions(endpoints: DiscoveredEndpoint[]): CompanionVariableDefinition[] {
	const definitions: CompanionVariableDefinition[] = [
		{ variableId: 'connection_state', name: 'Connection state' },
		{ variableId: 'last_error', name: 'Last error' },
		{ variableId: 'product_name', name: 'Product name' },
	]

	for (const endpoint of endpoints) {
		if (!endpoint.methods.includes('GET')) continue
		if (endpoint.unsupported) continue

		const prefix = endpointToVariablePrefix(endpoint)
		const override = endpointOverrides[endpoint.path]
		const domainLabel = endpoint.domain.charAt(0).toUpperCase() + endpoint.domain.slice(1)

		if (endpoint.responseSchema?.properties) {
			for (const [key, prop] of Object.entries(endpoint.responseSchema.properties)) {
				definitions.push({
					variableId: `${prefix}_${key}`,
					name: `${override?.label ?? domainLabel}: ${prop.description ?? key}`,
				})
			}
		} else {
			definitions.push({
				variableId: prefix,
				name: override?.label ?? `${domainLabel}: ${endpoint.summary}`,
			})
		}
	}

	return definitions
}

export function updateVariableValues(self: ModuleInstance, endpoints: DiscoveredEndpoint[]): void {
	const values: CompanionVariableValues = {
		connection_state: self.connectionState,
		last_error: self.lastError,
		product_name: self.productName,
	}

	for (const endpoint of endpoints) {
		if (!endpoint.methods.includes('GET')) continue
		if (endpoint.unsupported) continue

		const prefix = endpointToVariablePrefix(endpoint)
		const storeValue = self.store.get(endpoint.path)

		if (endpoint.responseSchema?.properties) {
			for (const key of Object.keys(endpoint.responseSchema.properties)) {
				values[`${prefix}_${key}`] = toStringValue(getPathValue(storeValue, key))
			}
		} else {
			values[prefix] = toStringValue(storeValue)
		}
	}

	self.setVariableValues(values)
}
