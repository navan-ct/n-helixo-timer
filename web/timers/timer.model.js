import mongoose from "mongoose";

import {
  TARGET_TYPES,
  TIMER_LIMITS,
  TIMER_SIZES,
  TIMER_TYPES,
  URGENCY_EFFECTS,
} from "./timer.constants.js";

const { Schema } = mongoose;

const NAME_COLLATION = { locale: "en", strength: 2 };

const targetResourceSchema = new Schema(
  {
    id: { type: String, required: true },
    title: { type: String, required: true },
    handle: { type: String, default: "" },
    imageUrl: { type: String, default: null },
    imageAlt: { type: String, default: "" },
  },
  { _id: false },
);

const targetSchema = new Schema(
  {
    type: { type: String, enum: TARGET_TYPES, required: true },
    resources: { type: [targetResourceSchema], default: [] },
  },
  { _id: false },
);

function isCountdown() {
  return this.type === "countdown";
}

function isEvergreen() {
  return this.type === "evergreen";
}

const timerSchema = new Schema(
  {
    shop: { type: String, required: true, immutable: true },
    type: { type: String, enum: TIMER_TYPES, required: true, immutable: true },
    name: { type: String, required: true, maxlength: TIMER_LIMITS.NAME_MAX_LENGTH },
    description: { type: String, default: "", maxlength: TIMER_LIMITS.DESCRIPTION_MAX_LENGTH },
    // Countdown timers: one schedule for every shopper.
    startsAt: { type: Date, required: isCountdown },
    endsAt: { type: Date, required: isCountdown },
    timezone: { type: String, required: isCountdown },
    // Evergreen timers: how long each shopper's countdown runs from their first visit.
    durationMinutes: {
      type: Number,
      required: isEvergreen,
      min: TIMER_LIMITS.DURATION_MIN_MINUTES,
      max: TIMER_LIMITS.DURATION_MAX_MINUTES,
      validate: { validator: Number.isInteger, message: "durationMinutes must be an integer" },
    },
    color: { type: String, required: true, match: /^#[0-9a-f]{6}$/ },
    size: { type: String, enum: TIMER_SIZES, required: true },
    urgency: { type: String, enum: URGENCY_EFFECTS, required: true },
    target: { type: targetSchema, required: true },
  },
  {
    timestamps: true,
    strict: "throw",
    optimisticConcurrency: true,
    // Collections and indexes are created explicitly at startup (see
    // db/mongoose.js#syncModelIndexes), not as a side effect of importing the model.
    autoCreate: false,
    autoIndex: false,
  },
);

// Every query is scoped to a shop, so each index leads with `shop`. Lists show
// one type at a time, most recently created first by default.
timerSchema.index({ shop: 1, type: 1, createdAt: -1 });
timerSchema.index({ shop: 1, startsAt: 1 });
timerSchema.index({ shop: 1, endsAt: 1 });
timerSchema.index({ shop: 1, name: 1 }, { collation: NAME_COLLATION });
// Supports the storefront lookup of timers for a given product or collection.
timerSchema.index({ shop: 1, "target.resources.id": 1 });

export { NAME_COLLATION };

export const Timer = mongoose.models.Timer ?? mongoose.model("Timer", timerSchema);
