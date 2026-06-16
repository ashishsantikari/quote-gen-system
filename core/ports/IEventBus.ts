import type { QuoteEvent, EventType } from "../events/types";

export interface IEventBus {
  publish(event: QuoteEvent): Promise<void>;
  subscribe(eventType: EventType, handler: (event: QuoteEvent) => Promise<void>): void;
}
