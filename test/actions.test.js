import test from 'node:test'
import assert from 'node:assert/strict'

// eslint-disable-next-line n/no-unpublished-import -- dist is built by the test command.
import { buildBodyFromOptions, buildFieldsFromSchema } from '../dist/actions.js'

const numericSchema = {
	type: 'object',
	properties: {
		iso: { type: 'integer', description: 'ISO', minimum: 100, maximum: 25600, example: 400 },
	},
}

test('numeric actions expose an optional variable value', () => {
	const fields = buildFieldsFromSchema(numericSchema)

	assert.equal(fields[0].id, 'iso')
	assert.equal(fields[0].type, 'number')
	assert.deepEqual(fields[1], {
		id: 'iso__variable',
		type: 'textinput',
		label: 'ISO (variable)',
		default: '',
		useVariables: true,
		description: 'Optional. When set, this value overrides the numeric field above.',
	})
})

test('resolved variable values override the static numeric value', () => {
	assert.deepEqual(buildBodyFromOptions(numericSchema, { iso: 400, iso__variable: '800' }), { iso: 800 })
})

test('an empty variable field preserves existing actions', () => {
	assert.deepEqual(buildBodyFromOptions(numericSchema, { iso: 400, iso__variable: '' }), { iso: 400 })
})

test('resolved variable values still obey the camera schema', () => {
	assert.throws(() => buildBodyFromOptions(numericSchema, { iso: 400, iso__variable: '99' }), /at least 100/)
	assert.throws(() => buildBodyFromOptions(numericSchema, { iso: 400, iso__variable: '400.5' }), /integer/)
})
