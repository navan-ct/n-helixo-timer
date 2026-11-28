import mongoose from "mongoose";

import { startOfUtcDay } from "./analytics.model.js";

/** The home page compares this many days with the same number of days before. */
export const SUMMARY_DAYS = 30;

const DAY_MS = 24 * 60 * 60_000;

/**
 * Reads timer impressions for the admin. Every read is scoped to one shop.
 * Impression days are UTC days, so "the last 30 days" is today (UTC) and the
 * 29 days before it.
 *
 * @param {{
 *   TimerImpression: import("mongoose").Model<any>,
 *   now?: () => Date,
 * }} deps
 */
export function createAnalyticsService({ TimerImpression, now = () => new Date() }) {
  return {
    /**
     * Impressions in the last `SUMMARY_DAYS` days and in the period before.
     * @param {string} shop
     */
    async summary(shop) {
      const today = startOfUtcDay(now()).getTime();
      const currentStart = new Date(today - (SUMMARY_DAYS - 1) * DAY_MS);
      const previousStart = new Date(today - (2 * SUMMARY_DAYS - 1) * DAY_MS);

      const totals = await TimerImpression.aggregate([
        { $match: { shop, day: { $gte: previousStart } } },
        {
          $group: {
            _id: { $cond: [{ $gte: ["$day", currentStart] }, "current", "previous"] },
            count: { $sum: "$count" },
          },
        },
      ]);

      const total = (period) => totals.find(({ _id }) => _id === period)?.count ?? 0;
      return {
        impressions: {
          days: SUMMARY_DAYS,
          current: total("current"),
          previous: total("previous"),
        },
      };
    },

    /**
     * All-time impressions for each of the given timers.
     * @param {string} shop
     * @param {string[]} timerIds
     * @returns {Promise<Map<string, number>>} Timers that were never seen are left out.
     */
    async impressionsByTimer(shop, timerIds) {
      if (timerIds.length === 0) return new Map();
      const rows = await TimerImpression.aggregate([
        {
          $match: {
            shop,
            timerId: { $in: timerIds.map((id) => new mongoose.Types.ObjectId(id)) },
          },
        },
        { $group: { _id: "$timerId", count: { $sum: "$count" } } },
      ]);
      return new Map(rows.map(({ _id, count }) => [_id.toString(), count]));
    },

    /** Deletes all of a shop's impressions (used by the shop/redact privacy webhook). */
    async removeAllForShop(shop) {
      const { deletedCount } = await TimerImpression.deleteMany({ shop });
      return deletedCount;
    },
  };
}
