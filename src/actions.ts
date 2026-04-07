import type {
	CompanionActionDefinition,
	CompanionActionDefinitions,
	CompanionActionEvent,
	SomeCompanionActionInputField,
} from '@companion-module/base'
import type { ModuleInstance } from './main.js'
import type { DiscoveredEndpoint, HttpMethod, ParsedSchema, SchemaProperty } from './types.js'
import { endpointOverrides } from './overrides.js'

function schemaPropertyToField(
	key: string,
	prop: SchemaProperty,
	override?: { inputType?: string; label?: string },
): SomeCompanionActionInputField {
	const label = override?.label ?? prop.description ?? key
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
			choices: prop.enum.map((value) => ({ id: value, label: value })),
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
			body[key] = Number(value)
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
	const mutationMethods = endpoint.methods.filter((m) => m !== 'GET')

	const fields: SomeCompanionActionInputField[] = []

	if (mutationMethods.length > 1) {
		fields.push({
			id: 'method',
			type: 'dropdown',
			label: 'Method',
			default: mutationMethods[0],
			choices: mutationMethods.map((m) => ({ id: m, label: m })),
		})
	}

	const primaryMethod = mutationMethods.includes('PUT') ? 'PUT' : mutationMethods[0]
	const requestSchema = endpoint.requestSchemas?.[primaryMethod]
	fields.push(...buildFieldsFromSchema(requestSchema, override?.propertyOverrides))

	const actionName = override?.label ?? endpoint.summary
	const actionDescription = override?.description ?? `${mutationMethods.join('/')} ${endpoint.path}`

	return {
		name: actionName,
		description: actionDescription,
		options: fields,
		callback: async (event: CompanionActionEvent) => {
			try {
				const actionOptions = (event.options ?? {}) as Record<string, unknown>

				let method: HttpMethod = primaryMethod
				if (mutationMethods.length > 1 && actionOptions.method) {
					const requested = (typeof actionOptions.method === 'string' ? actionOptions.method : '') as HttpMethod
					if (mutationMethods.includes(requested)) method = requested
				}

				const body =
					method === 'GET' || method === 'DELETE'
						? undefined
						: buildBodyFromOptions(endpoint.requestSchemas?.[method] ?? requestSchema, actionOptions)

				const result = await self.client.execute(method, endpoint.path, body)
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
		const hasMutation = endpoint.methods.some((m) => m !== 'GET')
		if (!hasMutation) continue
		if (endpoint.unsupported) continue
		if (endpoint.deprecated) continue

		const id = endpointToActionId(endpoint)
		definitions[id] = buildActionForEndpoint(self, endpoint)
	}
	return definitions
}
