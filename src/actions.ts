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
): SomeCompanionActionInputField[] {
	if (!schema?.properties) return []
	const fields: SomeCompanionActionInputField[] = []
	for (const [key, prop] of Object.entries(schema.properties)) {
		fields.push(schemaPropertyToField(key, prop, overrides?.[key]))
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

function buildActionForEndpoint(self: ModuleInstance, endpoint: DiscoveredEndpoint): CompanionActionDefinition {
	const override = endpointOverrides[endpoint.path]
	const mutationMethods: HttpMethod[] = endpoint.methods.filter((m: HttpMethod) => m !== 'GET')

	// Auto-pick the best method: prefer POST over deprecated PUT, fall back to first available
	const primaryMethod = mutationMethods.includes('POST') ? 'POST' : mutationMethods[0]
	const requestSchema = endpoint.requestSchemas?.[primaryMethod]

	const fields: SomeCompanionActionInputField[] = []
	fields.push(...buildFieldsFromSchema(requestSchema, override?.propertyOverrides))

	const actionName = override?.label ?? endpoint.summary
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
		definitions[id] = buildActionForEndpoint(self, endpoint)
	}
	return definitions
}
