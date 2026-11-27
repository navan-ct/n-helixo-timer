import mongoose from "mongoose";

import {
  TARGET_TYPES,
  TIMER_LIMITS,
  TIMER_POSITIONS,
  TIMER_SIZES,
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

const timerSchema = new Schema(
  {
    shop: { type: String, required: true, immutable: true },
    name: { type: String, required: true, maxlength: TIMER_LIMITS.NAME_MAX_LENGTH },
    description: { type: String, default: "", maxlength: TIMER_LIMITS.DESCRIPTION_MAX_LENGTH },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    timezone: { type: String, required: true },
    color: { type: String, required: true, match: /^#[0-9a-f]{6}$/ },
    size: { type: String, enum: TIMER_SIZES, required: true },
    position: { type: String, enum: TIMER_POSITIONS, required: true },
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

// Every query is scoped to a shop, so each index leads with `shop`.
timerSchema.index({ shop: 1, createdAt: -1 });
timerSchema.index({ shop: 1, startsAt: 1 });
timerSchema.index({ shop: 1, endsAt: 1 });
timerSchema.index({ shop: 1, name: 1 }, { collation: NAME_COLLATION });
// Supports the storefront lookup of timers for a given product or collection.
timerSchema.index({ shop: 1, "target.resources.id": 1 });

export { NAME_COLLATION };

export const Timer = mongoose.models.Timer ?? mongoose.model("Timer", timerSchema);
