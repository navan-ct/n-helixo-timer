import { describe, expect, it, vi } from "vitest";

import { silentLogger as logger } from "./lib/logger.js";
import { createPrivacyWebhookHandlers } from "./privacy.js";

describe("privacy webhooks", () => {
  it("erases a shop's timers on shop/redact", async () => {
    const timerService = { removeAllForShop: vi.fn().mockResolvedValue(3) };
    const handlers = createPrivacyWebhookHandlers({ timerService, logger });

    await handlers.SHOP_REDACT.callback("SHOP_REDACT", "alpha.myshopify.com", "{}", "webhook-1");

    expect(timerService.removeAllForShop).toHaveBeenCalledWith("alpha.myshopify.com");
  });

  it("acknowledges customer webhooks without touching timers", async () => {
    const timerService = { removeAllForShop: vi.fn() };
    const handlers = createPrivacyWebhookHandlers({ timerService, logger });

    await handlers.CUSTOMERS_DATA_REQUEST.callback("CUSTOMERS_DATA_REQUEST", "alpha.myshopify.com");
    await handlers.CUSTOMERS_REDACT.callback("CUSTOMERS_REDACT", "alpha.myshopify.com");

    expect(timerService.removeAllForShop).not.toHaveBeenCalled();
  });
});
