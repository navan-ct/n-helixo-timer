import { describe, expect, it, vi } from "vitest";

import { silentLogger as logger } from "./lib/logger.js";
import { createPrivacyWebhookHandlers } from "./privacy.js";

describe("privacy webhooks", () => {
  it("erases a shop's timers and analytics on shop/redact", async () => {
    const timerService = { removeAllForShop: vi.fn().mockResolvedValue(3) };
    const analyticsService = { removeAllForShop: vi.fn().mockResolvedValue(12) };
    const handlers = createPrivacyWebhookHandlers({ timerService, analyticsService, logger });

    await handlers.SHOP_REDACT.callback("SHOP_REDACT", "alpha.myshopify.com", "{}", "webhook-1");

    expect(timerService.removeAllForShop).toHaveBeenCalledWith("alpha.myshopify.com");
    expect(analyticsService.removeAllForShop).toHaveBeenCalledWith("alpha.myshopify.com");
  });

  it("acknowledges customer webhooks without touching shop data", async () => {
    const timerService = { removeAllForShop: vi.fn() };
    const analyticsService = { removeAllForShop: vi.fn() };
    const handlers = createPrivacyWebhookHandlers({ timerService, analyticsService, logger });

    await handlers.CUSTOMERS_DATA_REQUEST.callback("CUSTOMERS_DATA_REQUEST", "alpha.myshopify.com");
    await handlers.CUSTOMERS_REDACT.callback("CUSTOMERS_REDACT", "alpha.myshopify.com");

    expect(timerService.removeAllForShop).not.toHaveBeenCalled();
    expect(analyticsService.removeAllForShop).not.toHaveBeenCalled();
  });
});
