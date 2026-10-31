# ADR 0035 — Public holidays in the calendar from OpenHolidays

Status: accepted · Builds on [ADR 0010](0010-calendar.md), [0008](0008-leave.md), [0011](0011-gdpr-export-erasure.md)

## Context

The calendar's "Public holidays" layer showed only the person's own country, computed offline for Bulgaria and Germany
(ADR 0008) plus custom days HR adds. People work with colleagues in several countries and want to see Bulgarian, German and
English holidays side by side. [OpenHolidays API](https://www.openholidaysapi.org/en/) is free, needs no key and is
maintained as open data (`GET /PublicHolidays?countryIsoCode&languageIsoCode&validFrom&validTo`).

## Decisions

### 1. The API fetches, the browser never does

- `GET /api/v1/calendar/public-holidays?from&to&language` (`calendar.manage_own`, like the other calendar reads; at most 93
  days). The browser never calls OpenHolidays: no third party sees a visitor's IP, and the allowed host is fixed in code
  (`PUBLIC_HOLIDAYS_BASE_URL`, never taken from a client). `language` is `en | de | bg` (names come in that language when the
  feed has it, else English, else the first one).
- **Nothing personal leaves the server**: a request carries a country code, a date range and a language, nothing about a
  workspace, user or employee. Nothing is logged except the country, year and status class.
- Countries are the fixed list `PUBLIC_HOLIDAY_COUNTRIES = ['BG', 'DE', 'GB']`. **"English" holidays are England**: for `GB` the
  feed's items for the whole kingdom plus those whose subdivisions include `GB-ENG`. For `BG` and `DE` only **nationwide**
  holidays are shown; German state holidays (Epiphany, Corpus Christi and so on) are left out because the layer would
  otherwise show days most people do not have off. Types other than public holidays are ignored.

### 2. Cache and fallback

- A year of one country in one language is fetched once and kept in memory for 24 hours (a restart simply fetches again).
  When a fetch fails, the **last good copy is served even when stale**; with none, Bulgaria and Germany fall back to the
  built-in offline holidays (ADR 0008, `source: "builtin"`) and England has nothing. A failure never fails the request and
  never blocks the page.
- `PUBLIC_HOLIDAYS_FEED=false` turns the feed off (offline data only), for self-hosting without outbound access and for tests.
  Tests use a fake client behind the `HolidayFeedClient` token and never reach the network.

### 3. Informational only

- The feed is a **calendar layer**. Leave day counting, balances, capacity and attendance keep using the built-in and custom
  holidays of ADR 0008, so an outside service can never change anybody's balance. The page says the days are shown for
  information.
- Responses are public data, but the endpoint stays authenticated so it cannot be used as an open relay. No table, nothing to
  export or erase.

### 4. Web

- The "Public holidays" checkbox stays. Beside it, one toggle per country (Bulgaria, Germany, England); all on by default. Each
  entry says its country. The workspace's **custom** holidays (HR-defined) still come from the leave endpoint; the person's
  own built-in ones are no longer fetched there, so nothing shows twice.
- Header: the previous/next arrows and "Today" are outlined 44px buttons with chevron icons, the title is larger, and the layer
  toggles are pills with their colour dot, so a checked layer is obvious.

## Checking the live feed

Normal tests use a fake client and never reach the network. `apps/api/test/holiday-feed.live.test.ts` calls the
real feed when `HOLIDAY_FEED_LIVE=1`: Bulgarian and German nationwide days are present, German state days and
Scottish days are not, every item is a well-formed range. `.github/workflows/holiday-feed.yml` runs it every Monday
and on demand, so a change in the feed shows up before people see a wrong calendar.

## Consequences

- One new outbound dependency, free and optional. Failure degrades to offline data.
- Names are shown as the feed spells them; the translation test for built-in keys is unaffected.
- Allow `openholidaysapi.org` in any network policy of the API host (Render's free tier allows outbound HTTPS by default).
