import { parse as parseYaml } from 'yaml'
import { API_BASE_PATH, DOCUMENTATION_PATH } from './constants.js'
import type { ModuleConfig } from './config.js'
import type { DiscoveredEndpoint, DiscoveryResult, HttpMethod, ParsedSchema, SchemaProperty } from './types.js'

interface OpenApiSpec {
	info?: { title?: string }
	paths?: Record<string, Record<string, OpenApiOperation>>
	components?: { schemas?: Record<string, OpenApiSchemaObject> }
}

interface OpenApiOperation {
	summary?: string
	description?: string
	deprecated?: boolean
	requestBody?: {
		content?: Record<string, { schema?: OpenApiSchemaObject }>
	}
	responses?: Record<string, { content?: Record<string, { schema?: OpenApiSchemaObject }> }>
}

interface OpenApiSchemaObject {
	type?: string
	description?: string
	enum?: string[]
	minimum?: number
	maximum?: number
	example?: unknown
	nullable?: boolean
	properties?: Record<string, OpenApiSchemaObject>
	items?: OpenApiSchemaObject
	required?: string[]
	$ref?: string
	oneOf?: OpenApiSchemaObject[]
}

interface AsyncApiSpec {
	servers?: Record<string, { url?: string; protocol?: string }>
}

type LogFn = (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void

function getBaseUrl(config: ModuleConfig): string {
	const protocol = config.useHttps ? 'https' : 'http'
	return `${protocol}://${config.host}:${config.port}`
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), timeoutMs)
	try {
		const response = await fetch(url, { signal: controller.signal })
		if (!response.ok) throw new Error(`HTTP ${response.status}`)
		return await response.text()
	} finally {
		clearTimeout(timeout)
	}
}

function parseDocumentationHtml(html: string): { openApiYamls: string[]; asyncApiYamls: string[] } {
	const openApiYamls: string[] = []
	const asyncApiYamls: string[] = []

	const asyncApiSectionIndex = html.indexOf('asyncAPI')
	const openApiSection = asyncApiSectionIndex >= 0 ? html.slice(0, asyncApiSectionIndex) : html
	const asyncApiSection = asyncApiSectionIndex >= 0 ? html.slice(asyncApiSectionIndex) : ''

	const hrefRegex = /href="([^"]+\.yaml)"/g

	for (const match of openApiSection.matchAll(hrefRegex)) {
		openApiYamls.push(match[1])
	}

	for (const match of asyncApiSection.matchAll(hrefRegex)) {
		asyncApiYamls.push(match[1])
	}

	return { openApiYamls, asyncApiYamls }
}

function resolveRef(ref: string, components: Record<string, OpenApiSchemaObject> | undefined): OpenApiSchemaObject {
	if (!ref.startsWith('#/components/schemas/') || !components) return {}
	const name = ref.slice('#/components/schemas/'.length)
	return components[name] ?? {}
}

function resolveSchema(
	schema: OpenApiSchemaObject | undefined,
	components: Record<string, OpenApiSchemaObject> | undefined,
): OpenApiSchemaObject | undefined {
	if (!schema) return undefined
	if (schema.$ref) return resolveRef(schema.$ref, components)
	if (schema.oneOf && schema.oneOf.length > 0) {
		const merged: OpenApiSchemaObject = { type: 'object', properties: {}, required: [] }
		for (const variant of schema.oneOf) {
			const resolved = resolveSchema(variant, components)
			if (resolved?.properties) {
				Object.assign(merged.properties!, resolved.properties)
			}
		}
		return merged
	}
	return schema
}

function toSchemaProperty(
	schema: OpenApiSchemaObject,
	components: Record<string, OpenApiSchemaObject> | undefined,
): SchemaProperty {
	const resolved = schema.$ref ? resolveRef(schema.$ref, components) : schema
	const prop: SchemaProperty = {
		type: resolved.type ?? 'string',
		description: resolved.description,
		enum: resolved.enum,
		minimum: resolved.minimum,
		maximum: resolved.maximum,
		example: resolved.example,
		nullable: resolved.nullable,
	}
	if (resolved.properties) {
		prop.properties = {}
		for (const [key, value] of Object.entries(resolved.properties)) {
			prop.properties[key] = toSchemaProperty(value, components)
		}
		prop.required = resolved.required
	}
	if (resolved.items) {
		prop.items = toSchemaProperty(resolved.items, components)
	}
	return prop
}

function toParsedSchema(
	schema: OpenApiSchemaObject | undefined,
	components: Record<string, OpenApiSchemaObject> | undefined,
): ParsedSchema | undefined {
	if (!schema) return undefined
	const resolved = resolveSchema(schema, components)
	if (!resolved) return undefined

	const parsed: ParsedSchema = {
		type: resolved.type ?? 'object',
		description: resolved.description,
	}
	if (resolved.properties) {
		parsed.properties = {}
		for (const [key, value] of Object.entries(resolved.properties)) {
			parsed.properties[key] = toSchemaProperty(value, components)
		}
		parsed.required = resolved.required
	}
	return parsed
}

function domainFromTitle(title: string): string {
	return title
		.replace(/\s*Control\s*API\s*/i, '')
		.replace(/\s*Controller\s*/i, '')
		.trim()
		.toLowerCase()
}

function parseOpenApiSpec(yamlText: string): { endpoints: DiscoveredEndpoint[]; domain: string } {
	const spec: OpenApiSpec = parseYaml(yamlText)
	const components = spec.components?.schemas
	const domain = domainFromTitle(spec.info?.title ?? 'unknown')
	const endpoints: DiscoveredEndpoint[] = []

	if (!spec.paths) return { endpoints, domain }

	for (const [path, methods] of Object.entries(spec.paths)) {
		const endpointMethods: HttpMethod[] = []
		let summary = ''
		let description: string | undefined
		let deprecated = false
		let responseSchema: ParsedSchema | undefined
		const requestSchemas: Partial<Record<HttpMethod, ParsedSchema>> = {}

		for (const [method, operation] of Object.entries(methods)) {
			const upperMethod = method.toUpperCase() as HttpMethod
			if (!['GET', 'PUT', 'POST', 'DELETE'].includes(upperMethod)) continue

			endpointMethods.push(upperMethod)

			if (upperMethod === 'GET' || !summary) {
				summary = operation.summary ?? ''
				description = operation.description
				deprecated = operation.deprecated ?? false
			}

			if (upperMethod === 'GET') {
				const response200 = operation.responses?.['200'] ?? operation.responses?.['201']
				const content = response200?.content?.['application/json']
				responseSchema = toParsedSchema(content?.schema, components)
			}

			if (upperMethod === 'PUT' || upperMethod === 'POST') {
				const content = operation.requestBody?.content?.['application/json']
				const schema = toParsedSchema(content?.schema, components)
				if (schema) requestSchemas[upperMethod] = schema
			}
		}

		if (endpointMethods.length === 0) continue

		endpoints.push({
			path,
			domain,
			methods: endpointMethods,
			summary: summary || path,
			description,
			deprecated,
			responseSchema,
			requestSchemas: Object.keys(requestSchemas).length > 0 ? requestSchemas : undefined,
			subscribable: endpointMethods.includes('GET'),
		})
	}

	return { endpoints, domain }
}

function parseAsyncApiSpec(yamlText: string): string | undefined {
	const spec: AsyncApiSpec = parseYaml(yamlText)
	if (!spec.servers) return undefined
	for (const server of Object.values(spec.servers)) {
		if (server.protocol === 'ws' && server.url) return server.url
	}
	return undefined
}

export async function discoverCamera(config: ModuleConfig, log: LogFn): Promise<DiscoveryResult> {
	const baseUrl = getBaseUrl(config)
	const docUrl = `${baseUrl}${DOCUMENTATION_PATH}`

	log('info', `Fetching camera documentation from ${docUrl}`)
	const html = await fetchText(docUrl, config.requestTimeoutMs)
	const { openApiYamls, asyncApiYamls } = parseDocumentationHtml(html)

	log('info', `Found ${openApiYamls.length} OpenAPI specs and ${asyncApiYamls.length} AsyncAPI specs`)

	const allEndpoints: DiscoveredEndpoint[] = []
	const yamlFiles: string[] = []

	const openApiResults = await Promise.allSettled(
		openApiYamls.map(async (yamlPath: string) => {
			const url = `${baseUrl}/control/${yamlPath}`
			yamlFiles.push(yamlPath)
			const text = await fetchText(url, config.requestTimeoutMs)
			return parseOpenApiSpec(text)
		}),
	)

	for (let i = 0; i < openApiResults.length; i++) {
		const result = openApiResults[i]
		if (result.status === 'fulfilled') {
			allEndpoints.push(...result.value.endpoints)
			log('debug', `Parsed ${result.value.endpoints.length} endpoints from ${openApiYamls[i]}`)
		} else {
			log('warn', `Failed to fetch/parse ${openApiYamls[i]}: ${result.reason}`)
		}
	}

	let wsPath: string | undefined
	for (const yamlPath of asyncApiYamls) {
		try {
			const url = `${baseUrl}/control/${yamlPath}`
			const text = await fetchText(url, config.requestTimeoutMs)
			wsPath = parseAsyncApiSpec(text)
			if (wsPath) {
				log('info', `WebSocket path from AsyncAPI: ${wsPath}`)
				break
			}
		} catch (error) {
			log('warn', `Failed to fetch AsyncAPI ${yamlPath}: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	log('info', `Discovery complete: ${allEndpoints.length} endpoints, WebSocket: ${wsPath ?? 'none'}`)

	return { endpoints: allEndpoints, wsPath, yamlFiles }
}

/** Run async tasks with a concurrency limit */
async function runWithConcurrency<T>(tasks: (() => Promise<T>)[], limit: number): Promise<PromiseSettledResult<T>[]> {
	const results: PromiseSettledResult<T>[] = new Array(tasks.length)
	let nextIndex = 0

	async function worker(): Promise<void> {
		while (nextIndex < tasks.length) {
			const index = nextIndex++
			try {
				results[index] = { status: 'fulfilled', value: await tasks[index]() }
			} catch (reason) {
				results[index] = { status: 'rejected', reason }
			}
		}
	}

	await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, async () => worker()))
	return results
}

const CONCURRENCY_LIMIT = 5

/**
 * Probes endpoints and optionally fetches initial state in one pass.
 * Skips template-path endpoints. Uses concurrency limiting to avoid overwhelming the camera.
 */
export async function probeAndFetchState(
	endpoints: DiscoveredEndpoint[],
	config: ModuleConfig,
	log: LogFn,
	options: {
		probe: boolean
		fetchState: boolean
		onState?: (property: string, value: unknown) => void
	},
): Promise<void> {
	const baseUrl = getBaseUrl(config)
	const getEndpoints = endpoints.filter(
		(ep: DiscoveredEndpoint) => ep.methods.includes('GET') && !ep.path.includes('{'),
	)

	let loaded = 0
	let unsupported = 0

	const tasks = getEndpoints.map((ep: DiscoveredEndpoint) => async () => {
		const url = `${baseUrl}${API_BASE_PATH}${ep.path}`
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs)
		try {
			const response = await fetch(url, {
				method: 'GET',
				headers: { Accept: 'application/json' },
				signal: controller.signal,
			})

			if (response.status === 501) {
				ep.unsupported = true
				unsupported++
				log('debug', `Endpoint ${ep.path} returned 501 (not implemented)`)
				return
			}

			if (!response.ok) return

			if (options.fetchState && options.onState) {
				const contentType = response.headers.get('content-type') ?? ''
				const value = contentType.includes('application/json') ? await response.json() : await response.text()
				options.onState(ep.path, value)
				loaded++
			}
		} catch {
			// Network errors — leave as supported, just no data
		} finally {
			clearTimeout(timeout)
		}
	})

	await runWithConcurrency(tasks, CONCURRENCY_LIMIT)

	if (unsupported > 0) {
		log('info', `Probing: ${unsupported} endpoints returned 501`)
	}
	if (options.fetchState) {
		log('info', `Initial state: ${loaded}/${getEndpoints.length - unsupported} endpoints loaded`)
	}
}
