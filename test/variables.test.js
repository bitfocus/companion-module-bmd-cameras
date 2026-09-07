import assert from 'node:assert/strict'
import test from 'node:test'

// eslint-disable-next-line n/no-unpublished-import -- dist is built by the test command.
import { buildVariableDefinitions } from '../dist/variables.js'

test('keeps shutter speed and shutter angle as distinct variables', () => {
	const definitions = buildVariableDefinitions([
		{
			path: '/video/shutter',
			domain: 'video',
			methods: ['GET'],
			summary: 'Get current shutter',
			subscribable: true,
			responseSchema: {
				type: 'object',
				properties: {
					shutterSpeed: { type: 'integer' },
					shutterAngle: { type: 'integer' },
				},
			},
		},
	])

	assert.deepEqual(
		definitions.map((definition) => definition.variableId),
		['connection_state', 'last_error', 'product_name', 'video_shutter_shutterSpeed', 'video_shutter_shutterAngle'],
	)
})
