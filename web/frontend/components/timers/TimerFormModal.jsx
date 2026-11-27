import { useAppBridge } from "@shopify/app-bridge-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useSaveTimer } from "../../hooks/useTimers";
import { ApiError } from "../../utils/api";
import {
  describeTimeZone,
  formatTimeOfDay,
  parseTimeInput,
  zonedWallTimeToEpoch,
} from "../../utils/time";
import {
  HEX_COLOR,
  TIMER_LIMITS,
  TIMER_SIZES,
  URGENCY_EFFECTS,
  createEmptyForm,
  formFromTimer,
  mapServerFieldErrors,
  toTimerPayload,
  validateTimerForm,
} from "../../utils/timerForm";

import { TargetPicker } from "./TargetPicker";
import { TimerPreview } from "./TimerPreview";

export const TIMER_FORM_MODAL_ID = "timer-form-modal";

/** Field order used to bring the first invalid field into view. */
const FIELD_ORDER = [
  "name",
  "startDate",
  "startTime",
  "endDate",
  "endTime",
  "description",
  "resources",
  "color",
];

/**
 * Create/edit form for a countdown timer, shown in a Polaris modal.
 *
 * The modal element stays mounted so Polaris can animate it; the form inside is
 * remounted (via `formKey`) each time it opens, which resets its state.
 *
 * @param {{
 *   open: boolean,
 *   formKey: number,           Changes every time the modal is opened
 *   timer?: object | null,     Timer to edit; omit to create a new one
 *   timeZone: string,          Shop time zone used for scheduling
 *   onClose: () => void,
 * }} props
 */
export function TimerFormModal({ open, formKey, timer = null, timeZone, onClose }) {
  const { t } = useTranslation();
  const modalRef = useRef(null);

  // Sync the Polaris overlay with the `open` prop.
  useEffect(() => {
    const modal = modalRef.current;
    if (!modal?.showOverlay) return;
    if (open) modal.showOverlay();
    else modal.hideOverlay();
  }, [open]);

  return (
    <s-modal
      ref={modalRef}
      id={TIMER_FORM_MODAL_ID}
      heading={timer ? t("TimerForm.editHeading") : t("TimerForm.createHeading")}
      onhide={onClose}
    >
      <TimerForm key={formKey} timer={timer} timeZone={timeZone} onClose={onClose} />
    </s-modal>
  );
}

/**
 * The form fields plus the modal's footer actions (rendered into its slots).
 *
 * Polaris events are bound with lowercase props (`oninput`, `onchange`, `onhide`).
 * React 19 attaches `on<name>` props on custom elements as plain
 * `addEventListener(name)` calls on the element itself, which is required for
 * Polaris-specific events like `hide` and keeps field events consistent with them.
 */
function TimerForm({ timer, timeZone, onClose }) {
  const { t, i18n } = useTranslation();
  const shopify = useAppBridge();
  const formRef = useRef(null);
  const saveTimer = useSaveTimer();
  const locale = i18n.language;

  const [form, setForm] = useState(() =>
    timer ? formFromTimer(timer, locale) : createEmptyForm(),
  );
  const [showErrors, setShowErrors] = useState(false);
  const [serverErrors, setServerErrors] = useState({});
  const [formError, setFormError] = useState(null);

  const isEditing = Boolean(timer);
  const initialEnd = timer ? `${timer.schedule.endDate}T${timer.schedule.endTime}` : null;

  const clientErrors = useMemo(
    () => validateTimerForm(form, { timeZone, initialEnd }),
    [form, timeZone, initialEnd],
  );

  function errorFor(field) {
    if (serverErrors[field]) return serverErrors[field];
    if (!showErrors || !clientErrors[field]) return undefined;
    return t(`TimerForm.errors.${clientErrors[field]}`, {
      max: field === "name" ? TIMER_LIMITS.NAME_MAX_LENGTH : TIMER_LIMITS.DESCRIPTION_MAX_LENGTH,
    });
  }

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setServerErrors((current) => {
      if (!(field in current)) return current;
      const { [field]: _removed, ...rest } = current;
      return rest;
    });
  }

  function normalizeTime(field) {
    const parsed = parseTimeInput(form[field]);
    if (parsed) update(field, formatTimeOfDay(parsed, locale));
  }

  function revealFirstError(fields) {
    const first = FIELD_ORDER.find((field) => fields[field]);
    const element = first && formRef.current?.querySelector(`[data-field="${first}"]`);
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
    element?.focus?.();
  }

  async function handleSubmit(event) {
    event?.preventDefault();
    if (saveTimer.isPending) return;

    setFormError(null);
    if (Object.keys(clientErrors).length) {
      setShowErrors(true);
      revealFirstError(clientErrors);
      return;
    }

    try {
      await saveTimer.mutateAsync({ id: timer?.id, payload: toTimerPayload(form) });
      shopify.toast.show(isEditing ? t("TimerForm.toast.updated") : t("TimerForm.toast.created"));
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.status === 422 && Object.keys(error.fields).length) {
        const fields = mapServerFieldErrors(error.fields);
        setServerErrors(fields);
        setFormError(t("TimerForm.serverValidation"));
        revealFirstError(fields);
      } else {
        setFormError(error.message || t("TimerForm.genericError"));
      }
    }
  }

  const errorCount = showErrors
    ? new Set([...Object.keys(clientErrors), ...Object.keys(serverErrors)]).size
    : Object.keys(serverErrors).length;

  const previewEndsAt =
    clientErrors.endDate || clientErrors.endTime
      ? null
      : zonedWallTimeToEpoch(form.endDate, form.endTime, timeZone);
  // A blank start means "now", which the preview assumes when this is null.
  const previewStartsAt =
    !form.startDate || clientErrors.startDate || clientErrors.startTime
      ? null
      : zonedWallTimeToEpoch(form.startDate, form.startTime, timeZone);
  const timePlaceholder = t("TimerForm.timePlaceholder", {
    example: formatTimeOfDay("09:00", locale),
  });

  return (
    <>
      <form ref={formRef} onSubmit={handleSubmit} noValidate>
        <s-query-container>
          <s-stack gap="base">
            {(formError || (showErrors && errorCount > 0)) && (
              <s-banner
                tone="critical"
                heading={formError ?? t("TimerForm.fixErrors", { count: errorCount })}
              >
                {formError && errorCount > 0 && t("TimerForm.fixErrors", { count: errorCount })}
              </s-banner>
            )}

            <s-text-field
              data-field="name"
              label={t("TimerForm.name.label")}
              placeholder={t("TimerForm.name.placeholder")}
              required
              autocomplete="off"
              maxLength={TIMER_LIMITS.NAME_MAX_LENGTH}
              value={form.name}
              error={errorFor("name")}
              oninput={(event) => update("name", event.currentTarget.value)}
            />

            <s-stack gap="small-200">
              <s-grid
                gridTemplateColumns="@container (inline-size > 400px) 1fr 1fr, 1fr"
                gap="base"
              >
                <s-date-field
                  data-field="startDate"
                  label={t("TimerForm.startDate")}
                  value={form.startDate}
                  error={errorFor("startDate")}
                  onchange={(event) => update("startDate", event.currentTarget.value)}
                />
                <s-text-field
                  data-field="startTime"
                  label={t("TimerForm.startTime")}
                  icon="clock"
                  placeholder={timePlaceholder}
                  autocomplete="off"
                  value={form.startTime}
                  error={errorFor("startTime")}
                  oninput={(event) => update("startTime", event.currentTarget.value)}
                  onBlur={() => normalizeTime("startTime")}
                />
                <s-date-field
                  data-field="endDate"
                  label={t("TimerForm.endDate")}
                  required
                  value={form.endDate}
                  error={errorFor("endDate")}
                  onchange={(event) => update("endDate", event.currentTarget.value)}
                />
                <s-text-field
                  data-field="endTime"
                  label={t("TimerForm.endTime")}
                  required
                  icon="clock"
                  placeholder={timePlaceholder}
                  autocomplete="off"
                  value={form.endTime}
                  error={errorFor("endTime")}
                  oninput={(event) => update("endTime", event.currentTarget.value)}
                  onBlur={() => normalizeTime("endTime")}
                />
              </s-grid>
              <s-text color="subdued">
                {t("TimerForm.scheduleHelp", { timeZone: describeTimeZone(timeZone, locale) })}
              </s-text>
            </s-stack>

            <s-text-area
              data-field="description"
              label={t("TimerForm.description.label")}
              placeholder={t("TimerForm.description.placeholder")}
              rows={4}
              maxLength={TIMER_LIMITS.DESCRIPTION_MAX_LENGTH}
              details={t("TimerForm.description.details")}
              value={form.description}
              error={errorFor("description")}
              oninput={(event) => update("description", event.currentTarget.value)}
            />

            <s-box data-field="resources">
              <TargetPicker
                targetType={form.targetType}
                resources={form.resources}
                error={errorFor("resources")}
                onTargetTypeChange={(type) => {
                  setForm((current) => ({
                    ...current,
                    targetType: type,
                    // Selections don't carry over between products and collections.
                    resources: type === current.targetType ? current.resources : [],
                  }));
                  setServerErrors(({ resources: _removed, ...rest }) => rest);
                }}
                onResourcesChange={(resources) => update("resources", resources)}
              />
            </s-box>

            <s-divider />

            <s-grid
              gridTemplateColumns="@container (inline-size > 480px) auto 1fr, 1fr"
              gap="large"
              alignItems="start"
            >
              <s-stack gap="small-200" data-field="color">
                <s-text type="strong">{t("TimerForm.color.label")}</s-text>
                <s-color-picker
                  value={HEX_COLOR.test(form.color) ? form.color : undefined}
                  oninput={(event) => update("color", event.currentTarget.value)}
                />
                <s-color-field
                  label={t("TimerForm.color.hex")}
                  value={form.color}
                  error={errorFor("color")}
                  oninput={(event) => update("color", event.currentTarget.value)}
                />
              </s-stack>
              <s-stack gap="small-200">
                <s-text type="strong">{t("TimerForm.preview")}</s-text>
                <TimerPreview
                  color={form.color}
                  size={form.size}
                  urgency={form.urgency}
                  description={form.description}
                  startsAt={previewStartsAt}
                  endsAt={previewEndsAt}
                />
              </s-stack>
            </s-grid>

            <s-grid
              gridTemplateColumns="@container (inline-size > 400px) 1fr 1fr, 1fr"
              gap="base"
              alignItems="start"
            >
              <s-select
                label={t("TimerForm.size.label")}
                value={form.size}
                onchange={(event) => update("size", event.currentTarget.value)}
              >
                {TIMER_SIZES.map((size) => (
                  <s-option key={size} value={size}>
                    {t(`TimerForm.size.options.${size}`)}
                  </s-option>
                ))}
              </s-select>
              <s-select
                label={t("TimerForm.urgency.label")}
                value={form.urgency}
                onchange={(event) => update("urgency", event.currentTarget.value)}
              >
                {URGENCY_EFFECTS.map((effect) => (
                  <s-option key={effect} value={effect}>
                    {t(`TimerForm.urgency.options.${effect}`)}
                  </s-option>
                ))}
              </s-select>
            </s-grid>

            {/* Lets Enter in a single-line field submit the form. */}
            <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
          </s-stack>
        </s-query-container>
      </form>

      <s-button slot="secondary-actions" onClick={onClose}>
        {t("TimerForm.cancel")}
      </s-button>
      <s-button
        slot="primary-action"
        variant="primary"
        loading={saveTimer.isPending}
        onClick={handleSubmit}
      >
        {isEditing ? t("TimerForm.save") : t("TimerForm.create")}
      </s-button>
    </>
  );
}
