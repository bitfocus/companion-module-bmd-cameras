import assert from 'node:assert/strict'
import test from 'node:test'
// eslint-disable-next-line n/no-unpublished-import -- tests exercise the compiled module
import { NormalizeConfig } from '../dist/config.js'

test('existing configurations default insecure HTTPS to disabled', () => {
	const config = NormalizeConfig({
		host: 'camera.test',
		port: 4444,
		useHttps: true,
		fetchMode: 'eager',
		endpointHandling: 'probe',
		pollIntervalMs: 1000,
		requestTimeoutMs: 4000,
	})

	assert.equal(config.allowInsecureHttps, false)
})
