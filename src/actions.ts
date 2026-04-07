import type {
	CompanionActionDefinition,
	CompanionActionDefinitions,
	CompanionActionEvent,
	SomeCompanionActionInputField,
} from '@companion-module/base'
import type { ModuleInstance } from './main.js'
import {
	hasTemplateParams,
	type DiscoveredEndpoint,
	type HttpMethod,
	type ParsedSchema,
	type SchemaProperty,
} from './types.js'
import { endpointOverrides } from './overrides.js'
import type { StateStore } from './core/state-store.js'

/**
 * Find supported/available choices for an action property by looking up the store.
 * Convention: for `/video/iso` with property `iso`, look for store values at
 * paths like `/video/supportedISOs` that contain arrays.
 * Matching is strict: the "supported" endpoint path must contain the property name.
 */
function findSupportedChoices(
	store: StateStore,
	endpointPath: string,
	propertyKey: string,
	endpoints: DiscoveredEndpoint[],
): { id: string; label: string }[] | undefined {
	const basePath = endpointPath.substring(0, endpointPath.lastIndexOf('/'))
	const lowerProp = propertyKey.toLowerCase()

	for (const ep of endpoints) {
		if (!ep.path.startsWith(basePath + '/')) continue
		const lowerPath = ep.path.toLowerCase()
		if (!lowerPath.includes('supported') && !lowerPath.includes('selectable')) continue

		// The endpoint path itself must reference the property name
		// e.g., /video/supportedISOs matches property "iso"
		const pathSuffix = lowerPath.slice(basePath.length + 1)
		if (!pathSuffix.includes(lowerProp)) continue

		const storeValue = store.get(ep.path)
		if (!storeValue || typeof storeValue !== 'object') continue

		// Find the first array in the response
		for (const [, val] of Object.entries(storeValue as Record<string, unknown>)) {
			if (!Array.isArray(val) || val.length === 0) continue
			return val.map((v: unknown) => ({
				id: String(v),
				label: String(v),
			}))
		}
	}
	return undefined
}

function cleanBooleanDescription(description: string): string {
	return description
		.replace(/^When true,\s*/i, '')
		.replace(/^If true,\s*/i, '')
		.replace(/^Indicates if\s*/i, '')
		.replace(/^Indicates whether\s*/i, '')
		.replace(/^True when\s*/i, '')
		.replace(/^Enable or disable\s*/i, '')
		.replace(/^\w/, (c: string) => c.toUpperCase())
}

function schemaPropertyToField(
	key: string,
	prop: SchemaProperty,
	override?: { inputType?: string; label?: string },
): SomeCompanionActionInputField {
	const isBooleanField = prop.type === 'boolean' || override?.inputType === 'toggle'
	const rawLabel = override?.label ?? prop.description ?? key
	const label = isBooleanField ? cleanBooleanDescription(rawLabel) : rawLabel
	const inputType = override?.inputType

	if (inputType === 'toggle' || (prop.type === 'boolean' && inputType !== 'dropdown')) {
		return {
			id: key,
			type: 'checkbox',
			label,
			default: prop.example !== undefined ? Boolean(prop.example) : false,
		}
	}

	if (prop.enum && prop.enum.length > 0) {
		const defaultEnum =
			prop.example !== undefined && (typeof prop.example === 'string' || typeof prop.example === 'number')
				? String(prop.example)
				: prop.enum[0]
		return {
			id: key,
			type: 'dropdown',
			label,
			default: defaultEnum,
			choices: prop.enum.map((value: string) => ({ id: value, label: value })),
		}
	}

	if (prop.type === 'number' || prop.type === 'integer') {
		return {
			id: key,
			type: 'number',
			label,
			default: prop.example !== undefined ? Number(prop.example) : 0,
			min: prop.minimum ?? -999999,
			max: prop.maximum ?? 999999,
			step: prop.type === 'integer' ? 1 : undefined,
		}
	}

	return {
		id: key,
		type: 'textinput',
		label,
		default:
			prop.example !== undefined && (typeof prop.example === 'string' || typeof prop.example === 'number')
				? String(prop.example)
				: '',
		useVariables: true,
	}
}

function buildFieldsFromSchema(
	schema: ParsedSchema | undefined,
	overrides?: Record<string, { inputType?: string; label?: string }>,
	dynamicChoices?: Record<string, { id: string; label: string }[]>,
): SomeCompanionActionInputField[] {
	if (!schema?.properties) return []
	const fields: SomeCompanionActionInputField[] = []
	for (const [key, prop] of Object.entries(schema.properties)) {
		const choices = dynamicChoices?.[key]
		if (choices && choices.length > 0 && !prop.enum) {
			// Use dynamic choices from "supported" endpoints instead of free-form input
			const override = overrides?.[key]
			const rawLabel = override?.label ?? prop.description ?? key
			const label = prop.type === 'boolean' ? cleanBooleanDescription(rawLabel) : rawLabel
			fields.push({
				id: key,
				type: 'dropdown',
				label,
				default: choices[0].id,
				choices,
			})
		} else {
			fields.push(schemaPropertyToField(key, prop, overrides?.[key]))
		}
	}
	return fields
}

function buildBodyFromOptions(
	schema: ParsedSchema | undefined,
	options: Record<string, unknown>,
): Record<string, unknown> | undefined {
	if (!schema?.properties) return undefined
	const body: Record<string, unknown> = {}
	let hasValue = false
	for (const [key, prop] of Object.entries(schema.properties)) {
		const value = options[key]
		if (value === undefined || value === '') continue
		if (prop.type === 'number' || prop.type === 'integer') {
			const num = Number(value)
			if (Number.isNaN(num)) continue
			body[key] = num
		} else if (prop.type === 'boolean') {
			body[key] = Boolean(value)
		} else {
			body[key] = value
		}
		hasValue = true
	}
	return hasValue ? body : undefined
}

function endpointToActionId(endpoint: DiscoveredEndpoint): string {
	return endpoint.path.replace(/^\//, '').replace(/\//g, '_')
}

function buildActionForEndpoint(
	self: ModuleInstance,
	endpoint: DiscoveredEndpoint,
	allEndpoints: DiscoveredEndpoint[],
): CompanionActionDefinition {
	const override = endpointOverrides[endpoint.path]
	const mutationMethods: HttpMethod[] = endpoint.methods.filter((m: HttpMethod) => m !== 'GET')

	// Auto-pick the best method: prefer POST over deprecated PUT, fall back to first available
	const primaryMethod = mutationMethods.includes('POST') ? 'POST' : mutationMethods[0]
	const requestSchema = endpoint.requestSchemas?.[primaryMethod]

	// Look up dynamic choices from "supported*" endpoints in the store
	const dynamicChoices: Record<string, { id: string; label: string }[]> = {}
	if (requestSchema?.properties) {
		for (const key of Object.keys(requestSchema.properties)) {
			const choices = findSupportedChoices(self.store, endpoint.path, key, allEndpoints)
			if (choices) dynamicChoices[key] = choices
		}
	}

	const fields: SomeCompanionActionInputField[] = []
	fields.push(...buildFieldsFromSchema(requestSchema, override?.propertyOverrides, dynamicChoices))

	// Use the mutation method's summary (e.g., "Set..." instead of "Get...")
	const mutationSummary =
		endpoint.methodSummaries?.[primaryMethod] ?? endpoint.methodSummaries?.PUT ?? endpoint.methodSummaries?.POST
	const actionName = override?.label ?? mutationSummary ?? endpoint.summary
	const actionDescription = override?.description ?? endpoint.path

	return {
		name: actionName,
		description: actionDescription,
		options: fields,
		callback: async (event: CompanionActionEvent) => {
			try {
				const actionOptions = (event.options ?? {}) as Record<string, unknown>
				const method: HttpMethod = primaryMethod

				const body =
					method === 'GET' || method === 'DELETE'
						? undefined
						: buildBodyFromOptions(endpoint.requestSchemas?.[method] ?? requestSchema, actionOptions)

				const result = await self.client.request(method, endpoint.path, body)
				self.store.set(endpoint.path, result, 'rest')
			} catch (error) {
				self.log('error', `Action '${endpoint.path}' failed: ${error instanceof Error ? error.message : String(error)}`)
			}
		},
	}
}

export function buildActions(self: ModuleInstance, endpoints: DiscoveredEndpoint[]): CompanionActionDefinitions {
	const definitions: CompanionActionDefinitions = {}
	for (const endpoint of endpoints) {
		const hasMutation = endpoint.methods.some((m: HttpMethod) => m !== 'GET')
		if (!hasMutation) continue
		if (endpoint.unsupported) continue
		if (endpoint.deprecated) continue
		if (hasTemplateParams(endpoint.path)) continue

		const id = endpointToActionId(endpoint)
		definitions[id] = buildActionForEndpoint(self, endpoint, endpoints)
	}
	return definitions
}
