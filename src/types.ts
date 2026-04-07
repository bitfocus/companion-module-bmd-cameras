import type {
	CompanionActionDefinition,
	CompanionFeedbackDefinition,
	SomeCompanionActionInputField,
} from '@companion-module/base'

export type HttpMethod = 'GET' | 'PUT' | 'POST' | 'DELETE'

/** A single property within an OpenAPI schema object */
export interface SchemaProperty {
	type: string
	description?: string
	enum?: string[]
	minimum?: number
	maximum?: number
	example?: unknown
	nullable?: boolean
	properties?: Record<string, SchemaProperty>
	items?: SchemaProperty
	required?: string[]
}

/** Parsed representation of an OpenAPI schema (request body or response) */
export interface ParsedSchema {
	type: string
	properties?: Record<string, SchemaProperty>
	required?: string[]
	description?: string
}

/** A single endpoint discovered from the camera's OpenAPI specs */
export interface DiscoveredEndpoint {
	path: string
	domain: string
	methods: HttpMethod[]
	summary: string
	description?: string
	deprecated?: boolean
	/** OpenAPI schema for GET response */
	responseSchema?: ParsedSchema
	/** OpenAPI schemas for PUT/POST request bodies, keyed by method */
	requestSchemas?: Partial<Record<HttpMethod, ParsedSchema>>
	/** Whether this endpoint is subscribable via WebSocket */
	subscribable: boolean
	/** Whether this endpoint returned 501 during probing */
	unsupported?: boolean
}

/** The complete result of discovering a camera's API */
export interface DiscoveryResult {
	/** All discovered endpoints */
	endpoints: DiscoveredEndpoint[]
	/** WebSocket path from AsyncAPI spec, if available */
	wsPath?: string
	/** Camera product info (if /system/product was reachable) */
	productName?: string
	/** List of YAML files that were fetched */
	yamlFiles: string[]
}

export interface StateUpdateEvent {
	property: string
	value: unknown
	source: 'rest' | 'ws' | 'poll'
}

export type ActionDefinitionMap = Record<string, CompanionActionDefinition>
export type FeedbackDefinitionMap = Record<string, CompanionFeedbackDefinition>
export type ActionInputField = SomeCompanionActionInputField
