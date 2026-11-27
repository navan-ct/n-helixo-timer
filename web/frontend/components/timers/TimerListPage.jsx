import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { useTimerList } from "../../hooks/useTimers";

import { DeleteTimerModal } from "./DeleteTimerModal";
import { TimerFormModal } from "./TimerFormModal";
import { TimerTable } from "./TimerTable";

const DEFAULT_FILTERS = { status: "all", sort: "created_desc" };
const BROWSER_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
/** The empty state's graphic for each type: a schedule, or a running clock. */
const EMPTY_STATE_ICON = { countdown: "calendar-time", evergreen: "clock" };
/**
 * The loading and empty states share a minimum height, so the page doesn't
 * shift when one replaces the other. It's the minimum Polaris gives the empty
 * state of an empty table (10rem).
 */
const STATE_MIN_BLOCK_SIZE = "160px";

/**
 * The page that lists and manages one type of timer: countdown or evergreen.
 * Both share the table, the form and deletion; the type decides the copy, the
 * columns and filters, and the period fields in the form.
 *
 * @param {{ type: "countdown" | "evergreen" }} props
 */
export function TimerListPage({ type }) {
  const { t } = useTranslation();
  const isCountdown = type === "countdown";

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(DEFAULT_FILTERS.status);
  const [sort, setSort] = useState(DEFAULT_FILTERS.sort);
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search.trim(), 300);

  const [formState, setFormState] = useState({ open: false, timer: null, key: 0 });
  const [deleteState, setDeleteState] = useState({ open: false, timer: null });

  const { data, isPending, isFetching, isError, error, refetch } = useTimerList({
    type,
    query: debouncedSearch,
    // Only countdowns have a status to filter by.
    status: isCountdown ? status : undefined,
    sort,
    page,
  });

  const timers = data?.timers ?? [];
  const isFiltered = Boolean(debouncedSearch) || status !== "all";
  const hasNoTimers = !isPending && !isError && !isFiltered && data?.pageInfo.total === 0;

  // Step back a page if the last timer on the current page was deleted.
  if (data && page > 1 && timers.length === 0 && !isFetching) {
    setPage((current) => Math.max(1, current - 1));
  }

  function changeFilter(setter) {
    return (value) => {
      setter(value);
      setPage(1);
    };
  }

  const openForm = (timer) =>
    setFormState((current) => ({ open: true, timer, key: current.key + 1 }));
  const openCreate = () => openForm(null);
  const closeForm = () => setFormState((current) => ({ ...current, open: false }));

  return (
    <s-page heading={t(`TimersPage.${type}.title`)}>
      <s-button slot="primary-action" variant="primary" icon="plus" onClick={openCreate}>
        {t("TimersPage.createTimer")}
      </s-button>

      <s-stack gap="base">
        <s-paragraph color="subdued">{t(`TimersPage.${type}.subtitle`)}</s-paragraph>

        {isError && (
          <s-banner tone="critical" heading={t("TimersPage.loadError")}>
            {error?.message}
            <s-button slot="secondary-actions" onClick={() => refetch()}>
              {t("TimersPage.retry")}
            </s-button>
          </s-banner>
        )}

        {isPending ? (
          // First load: a spinner until we know whether to show the table or the
          // empty state, so neither flashes in and gets replaced. Polaris has no
          // skeleton components; a spinner is its loading pattern.
          <s-section accessibilityLabel={t("TimersPage.loading")}>
            <s-grid minBlockSize={STATE_MIN_BLOCK_SIZE} placeItems="center">
              <s-spinner size="large" accessibilityLabel={t("TimersPage.loading")} />
            </s-grid>
          </s-section>
        ) : hasNoTimers ? (
          <s-section accessibilityLabel={t(`TimersPage.${type}.emptyState.heading`)}>
            <s-grid minBlockSize={STATE_MIN_BLOCK_SIZE} alignItems="center">
              <s-empty-state heading={t(`TimersPage.${type}.emptyState.heading`)}>
                <s-icon slot="graphic" type={EMPTY_STATE_ICON[type]} />
                <s-text slot="subheading">{t(`TimersPage.${type}.emptyState.body`)}</s-text>
                <s-button slot="primary-action" variant="primary" onClick={openCreate}>
                  {t("TimersPage.createTimer")}
                </s-button>
              </s-empty-state>
            </s-grid>
          </s-section>
        ) : (
          !isError && (
            <TimerTable
              type={type}
              timers={timers}
              pageInfo={data?.pageInfo}
              loading={isFetching}
              search={search}
              status={status}
              sort={sort}
              onSearchChange={changeFilter(setSearch)}
              onStatusChange={changeFilter(setStatus)}
              onSortChange={changeFilter(setSort)}
              onClearFilters={() => {
                setSearch("");
                setStatus(DEFAULT_FILTERS.status);
                setPage(1);
              }}
              onPageChange={(delta) => setPage((current) => Math.max(1, current + delta))}
              onEdit={openForm}
              onDelete={(timer) => setDeleteState({ open: true, timer })}
            />
          )
        )}
      </s-stack>

      <TimerFormModal
        open={formState.open}
        formKey={formState.key}
        type={type}
        timer={formState.timer}
        timeZone={data?.timezone ?? BROWSER_TIME_ZONE}
        onClose={closeForm}
      />
      <DeleteTimerModal
        open={deleteState.open}
        timer={deleteState.timer}
        onClose={() => setDeleteState((current) => ({ ...current, open: false }))}
      />
    </s-page>
  );
}
