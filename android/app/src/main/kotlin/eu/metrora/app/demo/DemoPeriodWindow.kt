package eu.metrora.app.demo

import java.time.LocalDate

/**
 * The single bounded period authority for Demo Mode.
 *
 * The core Android period protocol is intentionally not changed here. Demo
 * uses the existing inclusive recent-days convention for `week` and
 * `30days`, while `month` is calendar-month-to-date.
 */
data class DemoPeriodWindow(
    val period: String,
    val start: LocalDate,
    val end: LocalDate,
) {
    init {
        require(period in SUPPORTED_PERIODS) { "Unsupported demo period." }
        require(!end.isBefore(start)) { "Demo period window must be ordered." }
    }

    fun contains(date: LocalDate): Boolean = !date.isBefore(start) && !date.isAfter(end)

    companion object {
        val SUPPORTED_PERIODS: List<String> = listOf("today", "week", "30days", "month")

        fun resolve(today: LocalDate, period: String): DemoPeriodWindow = when (period) {
            "today" -> DemoPeriodWindow(period, today, today)
            // Keep the established bounded recent-days convention: seven
            // inclusive calendar dates ending on Demo today.
            "week" -> DemoPeriodWindow(period, today.minusDays(6), today)
            // Keep 30days distinct from a calendar month: thirty inclusive
            // recent dates ending on Demo today.
            "30days" -> DemoPeriodWindow(period, today.minusDays(29), today)
            "month" -> DemoPeriodWindow(period, today.withDayOfMonth(1), today)
            else -> error("Unsupported demo period.")
        }
    }
}
