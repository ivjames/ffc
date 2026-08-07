// In-process domain events. Single-process pm2 is the deployment model (the
// same assumption the in-memory rate limiters document), so an EventEmitter is
// enough to fan out "something changed" signals — e.g. a completed round
// landing — to live subscribers like the leaderboard SSE stream. If the app
// ever goes multi-process, swap the emit/subscribe pair for Postgres
// LISTEN/NOTIFY without touching the subscribers' logic.
import { EventEmitter } from "node:events";

export const domainEvents = new EventEmitter();
// Every connected TV wall is a listener — don't warn at 11 of them.
domainEvents.setMaxListeners(0);

/** Event name: a fresh COMPLETED round was committed. Payload: { courseId }. */
export const ROUND_COMPLETED = "roundCompleted";
