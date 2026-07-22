import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
// eslint-disable-next-line n/no-unpublished-import -- tests exercise the compiled module
import { discoverCamera } from '../dist/discovery.js'

test('discovery resolves absolute and relative YAML paths and detects AsyncAPI case-insensitively', async () => {
	const server = http.createServer((request, response) => {
		response.end(
			request.url === '/control/documentation.html'
				? '<a href="/control/documentation/camera.yaml">camera</a><a href="system.yaml">system</a><h2>AsyncAPI</h2><a href="/control/documentation/notification.yaml">notification</a>'
				: request.url === '/control/documentation/camera.yaml'
					? 'openapi: 3.0.1\ninfo: { title: Camera Control API }\npaths:\n  /camera/test:\n    get: { summary: Test }'
					: request.url === '/control/system.yaml'
						? 'openapi: 3.0.1\ninfo: { title: System Control API }\npaths:\n  /system/test:\n    get: { summary: Test }'
						: 'asyncapi: 2.6.0\nservers:\n  public: { url: /control/ws, protocol: ws }',
		)
	})
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

	try {
		const address = server.address()
		assert.equal(typeof address, 'object')
		const result = await discoverCamera(
			{
				host: '127.0.0.1',
				port: address.port,
				useHttps: false,
				allowInsecureHttps: false,
				requestTimeoutMs: 1000,
			},
			() => undefined,
		)

		assert.equal(result.endpoints.length, 2)
		assert.equal(result.wsPath, '/control/ws')
	} finally {
		await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
	}
})
