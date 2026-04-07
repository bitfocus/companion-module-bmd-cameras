import { InstanceBase, InstanceStatus, type SomeCompanionConfigField, runEntrypoint } from '@companion-module/base'
import { NormalizeConfig, GetConfigFields, type ModuleConfig } from './config.js'
import { buildVariableDefinitions, updateVariableValues } from './variables.js'
import { UpgradeScripts } from './upgrades.js'
import { buildActions } from './actions.js'
import { buildFeedbacks } from './feedbacks.js'
import { CameraClient } from './core/camera-client.js'
import { FeedbackSubscriptions } from './core/feedback-subscriptions.js'
import { StateStore } from './core/state-store.js'
import { discoverCamera, probeEndpoints, fetchInitialState } from './discovery.js'
import type { DiscoveredEndpoint, DiscoveryResult, StateUpdateEvent } from './types.js'

export class ModuleInstance extends InstanceBase<ModuleConfig> {
	config!: ModuleConfig
	client!: CameraClient
	store = new StateStore()
	feedbackSubscriptions = new FeedbackSubscriptions()
	connectionState = 'disconnected'
	lastError = ''
	productName = ''

	/** In-memory cache of discovery result for reconnects */
	private cachedDiscovery: DiscoveryResult | undefined
	/** Currently active endpoints (after discovery + probing) */
	private activeEndpoints: DiscoveredEndpoint[] = []

	constructor(internal: unknown) {
		super(internal)
		this.store.onUpdate((event: StateUpdateEvent) => {
			this.onStoreUpdate(event.property)
		})
	}

	private onStoreUpdate(property: string): void {
		const feedbackIds = this.feedbackSubscriptions.getFeedbackIdsForProperty(property)
		if (feedbackIds.length > 0) this.checkFeedbacksById(...feedbackIds)
		updateVariableValues(this, this.activeEndpoints)
	}

	private setLastError(error: string): void {
		this.lastError = error
		updateVariableValues(this, this.activeEndpoints)
	}

	private setConnectionState(state: string): void {
		this.connectionState = state
		updateVariableValues(this, this.activeEndpoints)
	}

	private registerFromEndpoints(endpoints: DiscoveredEndpoint[]): void {
		this.activeEndpoints = endpoints
		this.setActionDefinitions(buildActions(this, endpoints))
		this.setFeedbackDefinitions(buildFeedbacks(this, endpoints))
		this.setVariableDefinitions(buildVariableDefinitions(endpoints))
		updateVariableValues(this, endpoints)
	}

	private async runDiscovery(): Promise<DiscoveryResult> {
		const log = (level: 'debug' | 'info' | 'warn' | 'error', message: string): void => this.log(level, message)
		const result = await discoverCamera(this.config, log)

		// Try to get product name
		try {
			const productData = (await this.client.request('GET', '/system/product')) as Record<string, unknown> | undefined
			if (productData && typeof productData === 'object') {
				this.productName = typeof productData.productName === 'string' ? productData.productName : ''
			}
		} catch {
			// Product endpoint may not exist
		}

		// Probe for 501s if configured
		if (this.config.endpointHandling === 'probe') {
			await probeEndpoints(result.endpoints, this.config, log)
		}

		this.cachedDiscovery = result
		return result
	}

	async init(config: ModuleConfig): Promise<void> {
		this.config = NormalizeConfig(config)

		this.client = new CameraClient({
			config: this.config,
			onLog: (level, message) => this.log(level, message),
			onState: (property, value, source) => this.store.set(property, value, source),
		})

		// Register empty definitions initially
		this.registerFromEndpoints([])

		this.updateStatus(InstanceStatus.Connecting)
		this.setConnectionState('connecting')

		try {
			// Discover the camera's API
			const discovery = await this.runDiscovery()

			// Set WebSocket path and start the client
			this.client.setWsPath(discovery.wsPath)
			await this.client.start()

			// Register all discovered endpoints
			this.registerFromEndpoints(discovery.endpoints)

			// Fetch initial state (eager mode)
			if (this.config.fetchMode === 'eager') {
				await fetchInitialState(
					discovery.endpoints,
					this.config,
					(level, message) => this.log(level, message),
					(property, value) => this.store.set(property, value, 'rest'),
				)
			}

			this.updateStatus(InstanceStatus.Ok)
			this.setConnectionState('connected')
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			this.setLastError(message)
			this.updateStatus(InstanceStatus.ConnectionFailure, message)
			this.setConnectionState('error')
		}
	}

	async destroy(): Promise<void> {
		if (this.client) {
			this.client.stop()
		}
		this.store.clear()
		this.cachedDiscovery = undefined
		this.activeEndpoints = []
		this.log('debug', 'destroy')
	}

	async configUpdated(config: ModuleConfig): Promise<void> {
		this.config = NormalizeConfig(config)
		this.client.updateConfig(this.config)
		this.store.clear()

		this.setConnectionState('reconnecting')
		this.updateStatus(InstanceStatus.Connecting)

		try {
			// If we have a cached discovery, use it immediately while re-discovering in background
			if (this.cachedDiscovery) {
				this.registerFromEndpoints(this.cachedDiscovery.endpoints)
				this.client.setWsPath(this.cachedDiscovery.wsPath)
				await this.client.start()
			}

			// Re-discover (updates cache)
			const discovery = await this.runDiscovery()
			this.client.setWsPath(discovery.wsPath)

			// If specs changed, re-register and restart client
			if (!this.cachedDiscovery || discovery.endpoints.length !== this.cachedDiscovery.endpoints.length) {
				this.client.stop()
				await this.client.start()
			}

			this.registerFromEndpoints(discovery.endpoints)

			if (this.config.fetchMode === 'eager') {
				await fetchInitialState(
					discovery.endpoints,
					this.config,
					(level, message) => this.log(level, message),
					(property, value) => this.store.set(property, value, 'rest'),
				)
			}

			this.updateStatus(InstanceStatus.Ok)
			this.setConnectionState('connected')
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			this.setLastError(message)
			this.updateStatus(InstanceStatus.ConnectionFailure, message)
			this.setConnectionState('error')
		}
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields()
	}
}

runEntrypoint(ModuleInstance, UpgradeScripts)
