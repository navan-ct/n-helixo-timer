import { useState } from "react";
import { useTranslation } from "react-i18next";

import { DeleteTimerModal } from "../components/timers/DeleteTimerModal";
import { TimerFormModal } from "../components/timers/TimerFormModal";
import { TimerTable } from "../components/timers/TimerTable";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useTimerList } from "../hooks/useTimers";

const DEFAULT_FILTERS = { status: "all", sort: "created_desc" };
const BROWSER_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const EMPTY_STATE_IMAGE = "https://cdn.shopify.com/static/images/polaris/patterns/callout.png";

export default function TimersPage() {
  const { t } = useTranslation();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(DEFAULT_FILTERS.status);
  const [sort, setSort] = useState(DEFAULT_FILTERS.sort);
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search.trim(), 300);

  const [formState, setFormState] = useState({ open: false, timer: null, key: 0 });
  const [deleteState, setDeleteState] = useState({ open: false, timer: null });

  const { data, isPending, isFetching, isError, error, refetch } = useTimerList({
    query: debouncedSearch,
    status,
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
    <s-page heading={t("TimersPage.title")}>
      <s-button slot="primary-action" variant="primary" icon="plus" onClick={openCreate}>
        {t("TimersPage.createTimer")}
      </s-button>

      <s-stack gap="base">
        <s-paragraph color="subdued">{t("TimersPage.subtitle")}</s-paragraph>

        {isError && (
          <s-banner tone="critical" heading={t("TimersPage.loadError")}>
            {error?.message}
            <s-button slot="secondary-actions" onClick={() => refetch()}>
              {t("TimersPage.retry")}
            </s-button>
          </s-banner>
        )}

        {hasNoTimers ? (
          <s-section accessibilityLabel={t("TimersPage.emptyState.heading")}>
            <s-empty-state heading={t("TimersPage.emptyState.heading")}>
              <s-box slot="graphic" maxInlineSize="200px">
                <s-image aspectRatio="1/0.5" src={EMPTY_STATE_IMAGE} alt="" />
              </s-box>
              <s-text slot="subheading">{t("TimersPage.emptyState.body")}</s-text>
              <s-button slot="primary-action" variant="primary" onClick={openCreate}>
                {t("TimersPage.createTimer")}
              </s-button>
            </s-empty-state>
          </s-section>
        ) : (
          !isError && (
            <TimerTable
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
