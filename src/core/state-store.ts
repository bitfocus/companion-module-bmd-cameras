import type { StateUpdateEvent } from '../types.js'

type Listener = (event: StateUpdateEvent) => void

export class StateStore {
	private readonly values = new Map<string, unknown>()
	private readonly listeners = new Set<Listener>()

	set(property: string, value: unknown, source: StateUpdateEvent['source']): void {
		const oldValue = this.values.get(property)
		if (Object.is(oldValue, value)) return

		this.values.set(property, value)
		const event: StateUpdateEvent = { property, value, source }
		for (const listener of this.listeners) listener(event)
	}

	get<T = unknown>(property: string): T | undefined {
		return this.values.get(property) as T | undefined
	}

	entries(): IterableIterator<[string, unknown]> {
		return this.values.entries()
	}

	clear(): void {
		this.values.clear()
	}

	onUpdate(listener: Listener): () => void {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}
}
