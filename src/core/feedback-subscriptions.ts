export class FeedbackSubscriptions {
	private readonly feedbackToProperty = new Map<string, string>()
	private readonly propertyToFeedbacks = new Map<string, Set<string>>()

	set(feedbackId: string, property: string): void {
		const previous = this.feedbackToProperty.get(feedbackId)
		if (previous && previous !== property) {
			this.unset(feedbackId)
		}

		this.feedbackToProperty.set(feedbackId, property)
		if (!this.propertyToFeedbacks.has(property)) this.propertyToFeedbacks.set(property, new Set())
		this.propertyToFeedbacks.get(property)?.add(feedbackId)
	}

	unset(feedbackId: string): void {
		const property = this.feedbackToProperty.get(feedbackId)
		if (!property) return
		this.feedbackToProperty.delete(feedbackId)

		const feedbackIds = this.propertyToFeedbacks.get(property)
		if (!feedbackIds) return
		feedbackIds.delete(feedbackId)
		if (feedbackIds.size === 0) this.propertyToFeedbacks.delete(property)
	}

	getFeedbackIdsForProperty(property: string): string[] {
		const ids = new Set<string>()
		for (const [registeredProperty, feedbackIds] of this.propertyToFeedbacks.entries()) {
			if (registeredProperty === property || this.matchesTemplate(registeredProperty, property)) {
				for (const id of feedbackIds) ids.add(id)
			}
		}
		return [...ids]
	}

	hasProperty(property: string): boolean {
		return this.propertyToFeedbacks.has(property)
	}

	properties(): string[] {
		return [...this.propertyToFeedbacks.keys()]
	}

	private matchesTemplate(template: string, property: string): boolean {
		if (!template.includes('{')) return false
		const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
		const wildcarded = escaped.replace(/\\\{[^}]+\\\}/g, '[^/]+')
		return new RegExp(`^${wildcarded}$`).test(property)
	}
}
