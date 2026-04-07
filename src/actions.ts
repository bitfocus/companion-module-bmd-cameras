import type {
	CompanionActionDefinition,
	CompanionActionDefinitions,
	CompanionActionEvent,
	SomeCompanionActionInputField,
} from '@companion-module/base'
import type { ModuleInstance } from './main.js'
import {
	errorMessage,
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
	prefix?: string,
): SomeCompanionActionInputField[] {
	if (!schema?.properties) return []
	const fields: SomeCompanionActionInputField[] = []
	for (const [key, prop] of Object.entries(schema.properties)) {
		const fieldId = prefix ? `${prefix}.${key}` : key

		// Recurse into nested objects
		if ((prop.type === 'object' || prop.properties) && prop.properties) {
			const nestedSchema: ParsedSchema = { type: 'object', properties: prop.properties, required: prop.required }
			fields.push(...buildFieldsFromSchema(nestedSchema, overrides, dynamicChoices, fieldId))
			continue
		}

		const choices = dynamicChoices?.[fieldId]
		if (choices && choices.length > 0 && !prop.enum) {
			const override = overrides?.[fieldId]
			const rawLabel = override?.label ?? prop.description ?? key
			const label = prop.type === 'boolean' ? cleanBooleanDescription(rawLabel) : rawLabel
			fields.push({
				id: fieldId,
				type: 'dropdown',
				label,
				default: choices[0].id,
				choices,
			})
		} else {
			fields.push(schemaPropertyToField(fieldId, prop, overrides?.[fieldId]))
		}
	}
	return fields
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
	const parts = path.split('.')
	let current = obj
	for (let i = 0; i < parts.length - 1; i++) {
		if (!(parts[i] in current) || typeof current[parts[i]] !== 'object') {
			current[parts[i]] = {}
		}
		current = current[parts[i]] as Record<string, unknown>
	}
	current[parts[parts.length - 1]] = value
}

function collectSchemaLeaves(schema: ParsedSchema, prefix?: string): { fieldId: string; prop: SchemaProperty }[] {
	const leaves: { fieldId: string; prop: SchemaProperty }[] = []
	if (!schema.properties) return leaves
	for (const [key, prop] of Object.entries(schema.properties)) {
		const fieldId = prefix ? `${prefix}.${key}` : key
		if ((prop.type === 'object' || prop.properties) && prop.properties) {
			leaves.push(
				...collectSchemaLeaves({ type: 'object', properties: prop.properties, required: prop.required }, fieldId),
			)
		} else {
			leaves.push({ fieldId, prop })
		}
	}
	return leaves
}

// Type coercion logic here is intentionally not shared with buildSingleFieldAction.
// This function coerces from Companion's typed form values (numbers are already numbers,
// booleans already booleans). buildSingleFieldAction coerces from a raw textinput string
// where 'true'/'1' must be parsed. The semantics are different enough that a shared
// helper would add coupling without clarity.
function buildBodyFromOptions(
	schema: ParsedSchema | undefined,
	options: Record<string, unknown>,
): Record<string, unknown> | undefined {
	if (!schema?.properties) return undefined
	const body: Record<string, unknown> = {}
	let hasValue = false

	for (const { fieldId, prop } of collectSchemaLeaves(schema)) {
		const value = options[fieldId]
		if (value === undefined || value === '') continue

		let coerced: unknown
		if (prop.type === 'number' || prop.type === 'integer') {
			const num = Number(value)
			if (Number.isNaN(num)) continue
			coerced = num
		} else if (prop.type === 'boolean') {
			coerced = Boolean(value)
		} else {
			coerced = value
		}

		setNestedValue(body, fieldId, coerced)
		hasValue = true
	}
	return hasValue ? body : undefined
}

function endpointToActionId(endpoint: DiscoveredEndpoint): string {
	return endpoint.path.replace(/^\//, '').replace(/\//g, '_')
}

/** Per-path mutex to serialize concurrent partial updates */
const pathMutexes = new Map<string, Promise<void>>()

async function withMutex(path: string, fn: () => Promise<void>): Promise<void> {
	const prev = pathMutexes.get(path) ?? Promise.resolve()
	const next = prev.then(fn, fn)
	pathMutexes.set(path, next)
	await next
}

function hasNestedSchema(schema: ParsedSchema | undefined): boolean {
	if (!schema?.properties) return false
	return Object.values(schema.properties).some(
		(prop: SchemaProperty) => prop.type === 'object' || prop.properties !== undefined,
	)
}

function getMutationMethod(endpoint: DiscoveredEndpoint): HttpMethod {
	const mutationMethods: HttpMethod[] = endpoint.methods.filter((m: HttpMethod) => m !== 'GET')
	return mutationMethods.includes('POST') ? 'POST' : mutationMethods[0]
}

function getMutationName(endpoint: DiscoveredEndpoint, method: HttpMethod): string {
	const override = endpointOverrides[endpoint.path]
	return (
		override?.label ??
		endpoint.methodSummaries?.[method] ??
		endpoint.methodSummaries?.PUT ??
		endpoint.methodSummaries?.POST ??
		endpoint.summary
	)
}

function getDynamicChoices(
	self: ModuleInstance,
	schema: ParsedSchema | undefined,
	endpointPath: string,
	allEndpoints: DiscoveredEndpoint[],
): Record<string, { id: string; label: string }[]> {
	const choices: Record<string, { id: string; label: string }[]> = {}
	if (!schema?.properties) return choices
	for (const key of Object.keys(schema.properties)) {
		const found = findSupportedChoices(self.store, endpointPath, key, allEndpoints)
		if (found) choices[key] = found
	}
	return choices
}

/** Deep merge: overlay partial values onto base, returning a new object */
function deepMerge(base: Record<string, unknown>, overlay: Record<string, unknown>): Record<string, unknown> {
	const result: Record<string, unknown> = { ...base }
	for (const [key, value] of Object.entries(overlay)) {
		if (
			value !== null &&
			typeof value === 'object' &&
			!Array.isArray(value) &&
			result[key] !== null &&
			typeof result[key] === 'object' &&
			!Array.isArray(result[key])
		) {
			result[key] = deepMerge(result[key] as Record<string, unknown>, value as Record<string, unknown>)
		} else {
			result[key] = value
		}
	}
	return result
}

/** Read current state, merge with partial body, then write. Serialized per-path. */
async function readMergeWrite(
	self: ModuleInstance,
	endpoint: DiscoveredEndpoint,
	method: HttpMethod,
	partialBody: Record<string, unknown>,
): Promise<void> {
	await withMutex(endpoint.path, async () => {
		let body = partialBody

		if (endpoint.methods.includes('GET')) {
			try {
				const current = await self.client.request('GET', endpoint.path)
				if (current && typeof current === 'object' && !Array.isArray(current)) {
					body = deepMerge(current as Record<string, unknown>, partialBody)
				}
			} catch {
				// GET fails — send the partial as-is
			}
		}

		const result = await self.client.request(method, endpoint.path, body)
		// If camera returned updated state (200), store it. Otherwise keep the body we sent.
		self.store.set(endpoint.path, result ?? body, 'rest')
	})
}

/** Standard full-update action */
function buildFullAction(
	self: ModuleInstance,
	endpoint: DiscoveredEndpoint,
	allEndpoints: DiscoveredEndpoint[],
): CompanionActionDefinition {
	const method = getMutationMethod(endpoint)
	const requestSchema = endpoint.requestSchemas?.[method]
	const override = endpointOverrides[endpoint.path]
	const dynamicChoices = getDynamicChoices(self, requestSchema, endpoint.path, allEndpoints)

	const fields: SomeCompanionActionInputField[] = []
	fields.push(...buildFieldsFromSchema(requestSchema, override?.propertyOverrides, dynamicChoices))

	return {
		name: getMutationName(endpoint, method),
		description: endpoint.path,
		options: fields,
		callback: async (event: CompanionActionEvent) => {
			try {
				const actionOptions = (event.options ?? {}) as Record<string, unknown>
				const body = buildBodyFromOptions(requestSchema, actionOptions)
				if (!body) return

				if (hasNestedSchema(requestSchema)) {
					await readMergeWrite(self, endpoint, method, body)
				} else {
					const result = await self.client.request(method, endpoint.path, body)
					if (result !== undefined) {
						self.store.set(endpoint.path, result, 'rest')
					}
				}
			} catch (error) {
				self.log('error', `Action '${endpoint.path}' failed: ${errorMessage(error)}`)
			}
		},
	}
}

/** Single-field action for nested endpoints: pick one field, set just that value */
function buildSingleFieldAction(self: ModuleInstance, endpoint: DiscoveredEndpoint): CompanionActionDefinition {
	const method = getMutationMethod(endpoint)
	const requestSchema = endpoint.requestSchemas?.[method]
	if (!requestSchema) return { name: getMutationName(endpoint, method), options: [], callback: async () => {} }
	const leaves = collectSchemaLeaves(requestSchema)

	const fieldChoices = leaves.map((leaf: { fieldId: string; prop: SchemaProperty }) => ({
		id: leaf.fieldId,
		label: leaf.prop.description ?? leaf.fieldId,
	}))

	return {
		name: `${getMutationName(endpoint, method)} (single field)`,
		description: `Set one field on ${endpoint.path}`,
		options: [
			{
				id: 'fieldId',
				type: 'dropdown',
				label: 'Field',
				default: fieldChoices[0]?.id ?? '',
				choices: fieldChoices,
			},
			{
				id: 'value',
				type: 'textinput',
				label: 'Value',
				default: '',
				useVariables: true,
			},
		],
		callback: async (event: CompanionActionEvent) => {
			try {
				const actionOptions = (event.options ?? {}) as Record<string, unknown>
				const fieldId = typeof actionOptions.fieldId === 'string' ? actionOptions.fieldId : ''
				const rawValue = actionOptions.value
				if (!fieldId || rawValue === undefined || rawValue === '') return

				const leaf = leaves.find((l: { fieldId: string; prop: SchemaProperty }) => l.fieldId === fieldId)
				if (!leaf) return

				let coerced: unknown = rawValue
				if (leaf.prop.type === 'number' || leaf.prop.type === 'integer') {
					coerced = Number(rawValue)
					if (Number.isNaN(coerced as number)) return
				} else if (leaf.prop.type === 'boolean') {
					coerced = rawValue === 'true' || rawValue === '1' || rawValue === true
				}

				const body: Record<string, unknown> = {}
				setNestedValue(body, fieldId, coerced)
				await readMergeWrite(self, endpoint, method, body)
			} catch (error) {
				self.log('error', `Action '${endpoint.path}' failed: ${errorMessage(error)}`)
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
		const method = getMutationMethod(endpoint)
		const requestSchema = endpoint.requestSchemas?.[method]

		definitions[id] = buildFullAction(self, endpoint, endpoints)

		// For nested endpoints, also generate a single-field action
		if (hasNestedSchema(requestSchema)) {
			definitions[`${id}_single`] = buildSingleFieldAction(self, endpoint)
		}
	}
	return definitions
}
