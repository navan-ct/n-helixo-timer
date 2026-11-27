import { useTranslation } from "react-i18next";

import { formatInstant } from "../../utils/time";

import "./TimerTable.css";

const STATUS_TONE = { active: "success", scheduled: "info", expired: "neutral" };
export const SORT_OPTIONS = [
  "created_desc",
  "start_asc",
  "start_desc",
  "end_asc",
  "name_asc",
  "name_desc",
];
export const STATUS_FILTERS = ["all", "active", "scheduled", "expired"];

function TargetSummary({ target }) {
  const { t } = useTranslation();
  if (target.type === "all") return t("TimerTable.target.all");
  const count = target.resources.length;
  const names = target.resources.map(({ title }) => title).join(", ");
  return (
    <s-stack gap="small-500">
      <s-text>{t(`TimerTable.target.${target.type}`, { count })}</s-text>
      <s-text color="subdued">
        <span className="timer-table__truncate" title={names}>
          {names}
        </span>
      </s-text>
    </s-stack>
  );
}

/**
 * Index table of timers with search, status filter, sort and pagination.
 *
 * @param {{
 *   timers: object[],
 *   pageInfo?: { hasNextPage: boolean, hasPreviousPage: boolean },
 *   loading: boolean,
 *   search: string,
 *   status: string,
 *   sort: string,
 *   onSearchChange: (value: string) => void,
 *   onStatusChange: (value: string) => void,
 *   onSortChange: (value: string) => void,
 *   onClearFilters: () => void,
 *   onPageChange: (delta: 1 | -1) => void,
 *   onEdit: (timer: object) => void,
 *   onDelete: (timer: object) => void,
 * }} props
 */
export function TimerTable({
  timers,
  pageInfo,
  loading,
  search,
  status,
  sort,
  onSearchChange,
  onStatusChange,
  onSortChange,
  onClearFilters,
  onPageChange,
  onEdit,
  onDelete,
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const isFiltered = Boolean(search) || status !== "all";

  return (
    <s-section padding="none" accessibilityLabel={t("TimerTable.label")}>
      <s-table
        paginate={pageInfo?.hasNextPage || pageInfo?.hasPreviousPage}
        hasNextPage={pageInfo?.hasNextPage}
        hasPreviousPage={pageInfo?.hasPreviousPage}
        loading={loading}
        onnextpage={() => onPageChange(1)}
        onpreviouspage={() => onPageChange(-1)}
      >
        <s-query-container slot="filters">
          <s-grid
            gridTemplateColumns="@container (inline-size > 560px) 1fr auto auto, 1fr"
            gap="small-200"
            alignItems="center"
          >
            <s-search-field
              label={t("TimerTable.search")}
              labelAccessibilityVisibility="exclusive"
              placeholder={t("TimerTable.search")}
              autocomplete="off"
              value={search}
              oninput={(event) => onSearchChange(event.currentTarget.value)}
            />
            <s-select
              label={t("TimerTable.statusFilter")}
              labelAccessibilityVisibility="exclusive"
              icon="filter"
              value={status}
              onchange={(event) => onStatusChange(event.currentTarget.value)}
            >
              {STATUS_FILTERS.map((value) => (
                <s-option key={value} value={value}>
                  {t(`TimerTable.statusOptions.${value}`)}
                </s-option>
              ))}
            </s-select>
            <s-select
              label={t("TimerTable.sortBy")}
              labelAccessibilityVisibility="exclusive"
              icon="sort"
              value={sort}
              onchange={(event) => onSortChange(event.currentTarget.value)}
            >
              {SORT_OPTIONS.map((value) => (
                <s-option key={value} value={value}>
                  {t(`TimerTable.sortOptions.${value}`)}
                </s-option>
              ))}
            </s-select>
          </s-grid>
        </s-query-container>

        <s-table-header-row>
          <s-table-header listSlot="primary">{t("TimerTable.columns.timer")}</s-table-header>
          <s-table-header listSlot="inline">{t("TimerTable.columns.status")}</s-table-header>
          <s-table-header listSlot="labeled">{t("TimerTable.columns.appliesTo")}</s-table-header>
          <s-table-header listSlot="labeled">{t("TimerTable.columns.starts")}</s-table-header>
          <s-table-header listSlot="labeled">{t("TimerTable.columns.ends")}</s-table-header>
          <s-table-header listSlot="inline">
            <s-text accessibilityVisibility="exclusive">{t("TimerTable.columns.actions")}</s-text>
          </s-table-header>
        </s-table-header-row>

        <s-table-body>
          {timers.map((timer) => (
            <s-table-row key={timer.id} clickDelegate={`timer-link-${timer.id}`}>
              <s-table-cell>
                <s-stack direction="inline" gap="small" alignItems="center">
                  <span
                    className="timer-table__swatch"
                    style={{ background: timer.color }}
                    aria-hidden="true"
                  />
                  <s-stack gap="small-500">
                    <s-link id={`timer-link-${timer.id}`} onClick={() => onEdit(timer)}>
                      {timer.name}
                    </s-link>
                    {timer.description && (
                      <s-text color="subdued">
                        <span className="timer-table__truncate" title={timer.description}>
                          {timer.description}
                        </span>
                      </s-text>
                    )}
                  </s-stack>
                </s-stack>
              </s-table-cell>
              <s-table-cell>
                <s-badge tone={STATUS_TONE[timer.status]}>
                  {t(`TimerTable.statusOptions.${timer.status}`)}
                </s-badge>
              </s-table-cell>
              <s-table-cell>
                <TargetSummary target={timer.target} />
              </s-table-cell>
              <s-table-cell>
                {formatInstant(timer.startsAt, { locale, timeZone: timer.timezone })}
              </s-table-cell>
              <s-table-cell>
                {formatInstant(timer.endsAt, { locale, timeZone: timer.timezone })}
              </s-table-cell>
              <s-table-cell>
                <s-button
                  variant="tertiary"
                  icon="menu-horizontal"
                  accessibilityLabel={t("TimerTable.actionsFor", { name: timer.name })}
                  commandFor={`timer-actions-${timer.id}`}
                />
                <s-menu
                  id={`timer-actions-${timer.id}`}
                  accessibilityLabel={t("TimerTable.actionsFor", { name: timer.name })}
                >
                  <s-button icon="edit" onClick={() => onEdit(timer)}>
                    {t("TimerTable.edit")}
                  </s-button>
                  <s-button icon="delete" tone="critical" onClick={() => onDelete(timer)}>
                    {t("TimerTable.delete")}
                  </s-button>
                </s-menu>
              </s-table-cell>
            </s-table-row>
          ))}
        </s-table-body>
      </s-table>

      {!loading && timers.length === 0 && (
        <s-box padding="large-200">
          <s-stack gap="small-200" alignItems="center">
            <s-icon type="search" color="subdued" />
            <s-heading>{t("TimerTable.noResults.heading")}</s-heading>
            <s-text color="subdued">{t("TimerTable.noResults.body")}</s-text>
            {isFiltered && (
              <s-button variant="tertiary" onClick={onClearFilters}>
                {t("TimerTable.noResults.clear")}
              </s-button>
            )}
          </s-stack>
        </s-box>
      )}
    </s-section>
  );
}
