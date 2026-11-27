import { TimerListPage } from "../components/timers/TimerListPage";

/** Evergreen timers: each shopper's countdown starts on their first visit. */
export default function EvergreenTimersPage() {
  return <TimerListPage type="evergreen" />;
}
