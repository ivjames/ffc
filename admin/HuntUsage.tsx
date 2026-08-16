import { useState } from 'react';
import { api, type HuntUsageOrgSummary, type HuntUsageRow } from './api';
import {
  Banner,
  Card,
  EmptyState,
  PageHeader,
  Select,
  Spinner,
  Table,
  Th,
  Td,
  useAsync,
} from './ui';

// Hunt usage — the invoice view (CLAUDE.md: exact billed token counts and
// computed cost for anything that burns model calls, cumulative, no
// estimates). Top: per-org monthly summary (orgSummary — the invoice lines).
// Below: the per-venue drilldown rows. org_admins get only their own org's
// data from the endpoint, so this page renders identically for every role.
// Dense unified tables on purpose; no charts.

/** Month bucket → a compact YYYY-MM label (handles both a bare date string
 *  and a Date-serialized ISO timestamp). */
export const fmtMonth = (m: string) => String(m).slice(0, 7);

// Whole-invoice totals read to the cent; the verify/screen split keeps the
// endpoint's 4 decimals so sub-cent screen spend doesn't render as $0.00.
const usdCents = (n: number) => `$${n.toFixed(2)}`;
const usdTenths = (n: number) => `$${n.toFixed(4)}`;

function OrgSummaryTable({ summary }: { summary: HuntUsageOrgSummary[] }) {
  return (
    <Card className="p-0">
      <Table size="xs">
        <thead>
          <tr>
            <Th>Month</Th>
            <Th>Org</Th>
            <Th align="right">Hunt rounds</Th>
            <Th align="right">Verify scans</Th>
            <Th align="right">Screen scans</Th>
            <Th align="right">Tokens in</Th>
            <Th align="right">Tokens out</Th>
            <Th align="right">Verify cost</Th>
            <Th align="right">Screen cost</Th>
            <Th align="right">Total</Th>
          </tr>
        </thead>
        <tbody>
          {summary.map((s, i) => (
            <tr key={i}>
              <Td className="whitespace-nowrap">{fmtMonth(s.month)}</Td>
              <Td>{s.orgName ?? 'Unattributed'}</Td>
              <Td align="right">{s.huntRounds.toLocaleString()}</Td>
              <Td align="right">{s.verifyScans.toLocaleString()}</Td>
              <Td align="right">{s.screenScans > 0 ? s.screenScans.toLocaleString() : ''}</Td>
              <Td align="right">{s.inputTokens.toLocaleString()}</Td>
              <Td align="right">{s.outputTokens.toLocaleString()}</Td>
              <Td align="right">{usdTenths(s.verifyCostUsd)}</Td>
              <Td align="right">{s.screenScans > 0 ? usdTenths(s.screenCostUsd) : ''}</Td>
              <Td align="right" className="font-semibold">
                {usdCents(s.apiCostUsd)}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

function VenueRowsTable({ rows }: { rows: HuntUsageRow[] }) {
  return (
    <Card className="p-0">
      <Table size="xs">
        <thead>
          <tr>
            <Th>Month</Th>
            <Th>Org</Th>
            <Th>Venue</Th>
            <Th align="right">Hunt rounds</Th>
            <Th align="right">Verify scans</Th>
            <Th align="right">Screen scans</Th>
            <Th align="right">Tokens in</Th>
            <Th align="right">Tokens out</Th>
            <Th align="right">Verify cost</Th>
            <Th align="right">Screen cost</Th>
            <Th align="right">Total</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <Td className="whitespace-nowrap">{fmtMonth(r.month)}</Td>
              <Td>{r.orgName ?? 'Unattributed'}</Td>
              <Td>
                {r.locationName ?? '—'}
                {r.locationSlug && <span className="ml-1 text-slate-400">/{r.locationSlug}</span>}
              </Td>
              <Td align="right">{r.huntRounds.toLocaleString()}</Td>
              <Td align="right">{r.verifyScans.toLocaleString()}</Td>
              <Td align="right">{r.screenScans > 0 ? r.screenScans.toLocaleString() : ''}</Td>
              <Td align="right">{r.inputTokens.toLocaleString()}</Td>
              <Td align="right">{r.outputTokens.toLocaleString()}</Td>
              <Td align="right">{usdTenths(r.verifyCostUsd)}</Td>
              <Td align="right">{r.screenScans > 0 ? usdTenths(r.screenCostUsd) : ''}</Td>
              <Td align="right" className="font-semibold">
                {usdCents(r.apiCostUsd)}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

export default function HuntUsage() {
  const [months, setMonths] = useState(6);
  // 'all' or a month bucket value — only filters the per-venue drilldown.
  const [monthFilter, setMonthFilter] = useState('all');
  const { data, error, loading } = useAsync(() => api.huntUsage(months), [months]);

  const rows = data?.rows ?? [];
  const monthOptions = [...new Set(rows.map((r) => fmtMonth(r.month)))];
  const filteredRows =
    monthFilter === 'all' ? rows : rows.filter((r) => fmtMonth(r.month) === monthFilter);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Hunt usage"
        description="Billed hunt vision spend — exact token counts from the provider's usage objects and computed cost, rolled up per org (the invoice lines) and per venue."
        actions={
          <Select
            aria-label="Months back"
            value={months}
            onChange={(e) => {
              setMonths(Number(e.target.value));
              setMonthFilter('all'); // the old filter may not exist in the new window
            }}
          >
            <option value={3}>Last 3 months</option>
            <option value={6}>Last 6 months</option>
            <option value={12}>Last 12 months</option>
            <option value={24}>Last 24 months</option>
          </Select>
        }
      />

      {loading && <Spinner />}
      {error && <Banner kind="error">{error.message}</Banner>}
      {data && data.orgSummary.length === 0 && (
        <EmptyState>No billed hunt scans in this window.</EmptyState>
      )}

      {data && data.orgSummary.length > 0 && (
        <>
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-700">Per org, per month</h2>
            <OrgSummaryTable summary={data.orgSummary} />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <h2 className="flex-1 text-sm font-semibold text-slate-700">Per venue</h2>
              {monthOptions.length > 1 && (
                <Select
                  aria-label="Filter by month"
                  value={monthFilter}
                  onChange={(e) => setMonthFilter(e.target.value)}
                >
                  <option value="all">All months</option>
                  {monthOptions.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
              )}
            </div>
            {filteredRows.length === 0 ? (
              <EmptyState compact>No venue rows for this month.</EmptyState>
            ) : (
              <VenueRowsTable rows={filteredRows} />
            )}
          </div>

          <p className="text-xs text-slate-500">
            Verify costs computed at {data.pricing.model} list rates ($
            {data.pricing.inputUsdPerMTok}/M input, ${data.pricing.outputUsdPerMTok}/M output
            tokens); screen scans carry the exact cost stamped per call. Org totals rounded to the
            cent; the verify/screen split keeps 4 decimals.
          </p>
        </>
      )}
    </div>
  );
}
