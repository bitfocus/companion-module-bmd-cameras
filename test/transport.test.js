import assert from 'node:assert/strict'
import test from 'node:test'
// eslint-disable-next-line n/no-unpublished-import -- tests exercise the compiled module
import { cameraFetch, getCameraDispatcher } from '../dist/transport.js'

test('the insecure dispatcher requires HTTPS and explicit opt-in', () => {
	assert.equal(getCameraDispatcher({ useHttps: false, allowInsecureHttps: true }), undefined)
	assert.equal(getCameraDispatcher({ useHttps: true, allowInsecureHttps: false }), undefined)
	assert.ok(getCameraDispatcher({ useHttps: true, allowInsecureHttps: true }))
})

test('regular HTTP and verified HTTPS use the existing global fetch', async () => {
	const originalFetch = globalThis.fetch
	let calls = 0
	globalThis.fetch = async () => {
		calls += 1
		return new Response('ok')
	}

	try {
		await cameraFetch({ useHttps: false, allowInsecureHttps: false }, 'http://camera.test')
		await cameraFetch({ useHttps: true, allowInsecureHttps: false }, 'https://camera.test')
		assert.equal(calls, 2)
	} finally {
		globalThis.fetch = originalFetch
	}
})
