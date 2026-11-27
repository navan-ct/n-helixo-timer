import { useAppBridge } from "@shopify/app-bridge-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { useDeleteTimer } from "../../hooks/useTimers";

/**
 * Confirms and performs deletion of a timer.
 *
 * `timer` is kept while the modal animates closed so its text doesn't flash empty.
 *
 * @param {{ open: boolean, timer: { id: string, name: string } | null, onClose: () => void }} props
 */
export function DeleteTimerModal({ open, timer, onClose }) {
  const { t } = useTranslation();
  const modalRef = useRef(null);

  useEffect(() => {
    const modal = modalRef.current;
    if (!modal?.showOverlay) return;
    if (open) modal.showOverlay();
    else modal.hideOverlay();
  }, [open]);

  return (
    <s-modal
      ref={modalRef}
      id="delete-timer-modal"
      heading={t("DeleteTimer.heading")}
      size="small"
      onhide={onClose}
    >
      {timer && <DeleteTimerContent key={timer.id} timer={timer} onClose={onClose} />}
    </s-modal>
  );
}

function DeleteTimerContent({ timer, onClose }) {
  const { t } = useTranslation();
  const shopify = useAppBridge();
  const deleteTimer = useDeleteTimer();

  async function handleDelete() {
    if (deleteTimer.isPending) return;
    try {
      await deleteTimer.mutateAsync(timer.id);
      shopify.toast.show(t("DeleteTimer.toast"));
      onClose();
    } catch {
      // Rendered below from the mutation's error state.
    }
  }

  return (
    <>
      <s-stack gap="base">
        {deleteTimer.isError && <s-banner tone="critical">{deleteTimer.error?.message}</s-banner>}
        <s-paragraph>{t("DeleteTimer.body", { name: timer.name })}</s-paragraph>
      </s-stack>
      <s-button slot="secondary-actions" onClick={onClose}>
        {t("DeleteTimer.cancel")}
      </s-button>
      <s-button
        slot="primary-action"
        variant="primary"
        tone="critical"
        loading={deleteTimer.isPending}
        onClick={handleDelete}
      >
        {t("DeleteTimer.confirm")}
      </s-button>
    </>
  );
}
