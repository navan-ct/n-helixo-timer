import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * How many times each timer was seen, per UTC day: one document per timer per
 * day it was seen. A view is counted when at least half of a running timer is
 * on screen for a second (see widget/src/core/impressions.js).
 *
 * Counts are anonymous and aggregated: no shopper, device, IP address or
 * cookie is ever stored. They outlive the timer they belong to, so the shop's
 * totals for a period stay the same when a timer is deleted, and they're
 * erased with the rest of the shop's data on shop/redact.
 */
const timerImpressionSchema = new Schema(
  {
    shop: { type: String, required: true, immutable: true },
    timerId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    /** Midnight UTC of the day the views happened. */
    day: { type: Date, required: true, immutable: true },
    count: { type: Number, required: true, min: 0 },
  },
  {
    collection: "timer_impressions",
    strict: "throw",
    versionKey: false,
    // Created explicitly at startup, like the timers collection (db/mongoose.js).
    autoCreate: false,
    autoIndex: false,
  },
);

// One counter per timer per day; upserts rely on it. Also answers per-timer totals.
timerImpressionSchema.index({ shop: 1, timerId: 1, day: 1 }, { unique: true });
// Shop totals for a period (the home page).
timerImpressionSchema.index({ shop: 1, day: 1 });

export const TimerImpression =
  mongoose.models.TimerImpression ?? mongoose.model("TimerImpression", timerImpressionSchema);

/** Midnight UTC of the day `date` falls on. */
export function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
