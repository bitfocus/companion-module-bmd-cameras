export interface EndpointOverride {
	/** Custom label for the action/variable */
	label?: string
	/** Custom description */
	description?: string
	/** Override specific property input types */
	propertyOverrides?: Record<
		string,
		{
			inputType?: 'toggle' | 'dropdown' | 'text' | 'number'
			label?: string
		}
	>
}

/**
 * Override mappings for specific endpoints.
 * Only endpoints that need better UX get overrides.
 * Everything else uses auto-generated labels from the OpenAPI summary.
 */
export const endpointOverrides: Record<string, EndpointOverride> = {
	'/transports/0/record': {
		label: 'Record',
		propertyOverrides: {
			recording: { inputType: 'toggle', label: 'Recording' },
		},
	},
	'/transports/0/play': {
		label: 'Play',
	},
	'/transports/0/stop': {
		label: 'Stop',
	},
	'/transports/0': {
		label: 'Transport Mode',
	},
	'/transports/0/playback': {
		label: 'Playback',
	},
	'/camera/colorBars': {
		label: 'Color Bars',
		propertyOverrides: {
			enabled: { inputType: 'toggle', label: 'Enabled' },
		},
	},
}
