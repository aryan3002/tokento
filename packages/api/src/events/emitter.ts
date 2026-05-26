// ============================================================
// Tokento — In-Process Event Emitter
// ============================================================
// Replaces EventBridge/SQS for MVP (per plan decision).
// Clean interface allows swapping to EventBridge later.

import { EventEmitter } from 'events';
import { EventType } from '@tokento/shared';
import { logger } from '../utils/logger';

class TokentoEventEmitter extends EventEmitter {
  emit(event: string, ...args: unknown[]): boolean {
    logger.debug({ event, args: args[0] }, `Event emitted: ${event}`);
    return super.emit(event, ...args);
  }
}

export const eventBus = new TokentoEventEmitter();

// Increase max listeners for webhook service
eventBus.setMaxListeners(50);

// Type-safe event emission
export function emitEvent(eventType: EventType, payload: Record<string, unknown>): void {
  eventBus.emit(eventType, {
    type: eventType,
    timestamp: new Date().toISOString(),
    ...payload,
  });
}

export default eventBus;
