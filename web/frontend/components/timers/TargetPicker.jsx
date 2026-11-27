import { useAppBridge } from "@shopify/app-bridge-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { TIMER_LIMITS, resourcesFromPicker } from "../../utils/timerForm";

const PICKER_TYPE = { products: "product", collections: "collection" };

/**
 * Chooses where a timer appears: all products, or specific products or
 * collections selected with the App Bridge Resource Picker.
 *
 * @param {{
 *   targetType: "all" | "products" | "collections",
 *   resources: import("../../utils/timerForm").TargetResource[],
 *   error?: string,
 *   onTargetTypeChange: (type: string) => void,
 *   onResourcesChange: (resources: import("../../utils/timerForm").TargetResource[]) => void,
 * }} props
 */
export function TargetPicker({
  targetType,
  resources,
  error,
  onTargetTypeChange,
  onResourcesChange,
}) {
  const shopify = useAppBridge();
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const isSpecific = targetType !== "all";
  const noun = targetType === "collections" ? "collections" : "products";

  async function openPicker(query = "") {
    try {
      const selection = await shopify.resourcePicker({
        type: PICKER_TYPE[targetType],
        action: "select",
        multiple: TIMER_LIMITS.MAX_TARGET_RESOURCES,
        query,
        selectionIds: resources.map(({ id }) => ({ id })),
        // Timers apply to whole products; archived products can't be sold.
        ...(targetType === "products" ? { filter: { variants: false, archived: false } } : {}),
      });
      if (selection) onResourcesChange(resourcesFromPicker(selection, targetType));
    } finally {
      setSearch("");
    }
  }

  function handleSearchInput(event) {
    const value = event.currentTarget.value;
    setSearch(value);
    // Like Shopify's own forms, typing opens the picker with that search.
    if (value.trim()) openPicker(value.trim());
  }

  return (
    <s-stack gap="small-200">
      <s-choice-list
        label={t("TargetPicker.label")}
        name="targetType"
        values={[targetType]}
        onchange={(event) => onTargetTypeChange(event.currentTarget.values[0])}
      >
        <s-choice value="all">{t("TargetPicker.all")}</s-choice>
        <s-choice value="products">{t("TargetPicker.products")}</s-choice>
        <s-choice value="collections">{t("TargetPicker.collections")}</s-choice>
      </s-choice-list>

      {isSpecific && (
        <s-stack gap="small-200">
          <s-grid gridTemplateColumns="1fr auto" gap="small-200" alignItems="end">
            <s-search-field
              label={t(`TargetPicker.search.${noun}`)}
              labelAccessibilityVisibility="exclusive"
              placeholder={t(`TargetPicker.search.${noun}`)}
              value={search}
              autocomplete="off"
              error={error}
              oninput={handleSearchInput}
            />
            <s-button onClick={() => openPicker()}>{t("TargetPicker.browse")}</s-button>
          </s-grid>

          {resources.length > 0 && (
            <s-stack gap="small-200">
              <s-text color="subdued">
                {t(`TargetPicker.selected.${noun}`, { count: resources.length })}
              </s-text>
              <s-box border="base" borderRadius="base" overflow="hidden">
                <s-stack gap="none">
                  {resources.map((resource, index) => (
                    <s-box key={resource.id}>
                      {index > 0 && <s-divider />}
                      <s-box paddingBlock="small-200" paddingInline="small">
                        <s-grid gridTemplateColumns="auto 1fr auto" gap="small" alignItems="center">
                          <s-thumbnail
                            src={resource.imageUrl ?? undefined}
                            alt={resource.imageAlt || resource.title}
                            size="small-200"
                          />
                          <s-text>{resource.title}</s-text>
                          <s-button
                            variant="tertiary"
                            icon="x"
                            accessibilityLabel={t("TargetPicker.remove", {
                              title: resource.title,
                            })}
                            onClick={() =>
                              onResourcesChange(resources.filter(({ id }) => id !== resource.id))
                            }
                          />
                        </s-grid>
                      </s-box>
                    </s-box>
                  ))}
                </s-stack>
              </s-box>
            </s-stack>
          )}
        </s-stack>
      )}
    </s-stack>
  );
}
