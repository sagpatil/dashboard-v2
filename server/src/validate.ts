// Shape checks for upstream responses. They cover the fields the server and
// the dashboard actually read, so a changed or broken upstream is reported as
// an upstream failure (and the cached value keeps being served) instead of
// reaching browsers as bad data. Extra fields are allowed.

type Obj = Record<string, unknown>;

const isObject = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isDate = (v: unknown) => isString(v) && !Number.isNaN(Date.parse(v));
const isNumeric = (v: unknown) => isString(v) && v.trim() !== '' && Number.isFinite(Number(v));
// Some upstreams send counts as strings
const isCountLike = (v: unknown) => isCount(v) || isNumeric(v);
const allStrings = (o: Obj, keys: readonly string[]) => keys.every(k => isString(o[k]));

const isPage = (v: unknown, item: (r: unknown) => boolean) =>
  isObject(v) && isObject(v._embedded) && Array.isArray(v._embedded.records) && v._embedded.records.every(item);

export const isLedger = (v: unknown): boolean =>
  isObject(v) &&
  Number.isInteger(v.sequence) &&
  isString(v.paging_token) &&
  isDate(v.closed_at) &&
  isCount(v.successful_transaction_count) &&
  isCount(v.failed_transaction_count) &&
  isCount(v.operation_count) &&
  isCount(v.protocol_version);

export const isLedgerPage = (v: unknown) => isPage(v, isLedger);

const FEE_KEYS = ['max', 'min', 'mode', 'p10', 'p20', 'p30', 'p40', 'p50', 'p60', 'p70', 'p80', 'p90', 'p95', 'p99'];

export const isFeeStats = (v: unknown): boolean =>
  isObject(v) &&
  isNumeric(v.last_ledger_base_fee) &&
  isNumeric(v.ledger_capacity_usage) &&
  isObject(v.fee_charged) && FEE_KEYS.every(k => isNumeric((v.fee_charged as Obj)[k])) &&
  isObject(v.max_fee);

export const isOperationsPage = (v: unknown) =>
  isPage(v, r =>
    isObject(r) && allStrings(r, ['id', 'type', 'source_account']) && isDate(r.created_at) && isObject(r._links));

export const isAccount = (v: unknown): boolean =>
  isObject(v) &&
  Array.isArray(v.balances) &&
  v.balances.every(b => isObject(b) && isString(b.asset_type) && isNumeric(b.balance));

export const isLumenSupply = (v: unknown): boolean =>
  isObject(v) &&
  ['originalSupply', 'inflationLumens', 'burnedLumens', 'totalSupply', 'upgradeReserve', 'feePool', 'sdfMandate', 'circulatingSupply']
    .every(k => isNumeric(v[k]));

export const isDailyHistory = (v: unknown): boolean =>
  Array.isArray(v) &&
  v.every(d => isObject(d) && isString(d.date) && isCountLike(d.transaction_count) && isCountLike(d.operation_count));

const isIncident = (v: unknown) =>
  isObject(v) && allStrings(v, ['id', 'name', 'status']) && Array.isArray(v.incident_updates);

export const isStatusSummary = (v: unknown): boolean =>
  isObject(v) &&
  isObject(v.status) && isString(v.status.indicator) && isString(v.status.description) &&
  Array.isArray(v.incidents) && v.incidents.every(isIncident) &&
  Array.isArray(v.scheduled_maintenances) && v.scheduled_maintenances.every(isIncident);

export const isIncidentHistory = (v: unknown): boolean =>
  isObject(v) && Array.isArray(v.incidents) && v.incidents.every(isIncident);
