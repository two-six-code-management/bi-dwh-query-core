/** RDS が集計データを保持している日数の既定値（DWH 基本設計書 §9 の候補値） */
export const BI_DEFAULT_RDS_RETENTION_DAYS = 30;

/** Athena のデータカタログの既定値（Glue Data Catalog） */
export const BI_DEFAULT_ATHENA_CATALOG = 'AwsDataCatalog';

/** 「今日」を求めるタイムゾーンの既定値（DB には JST の壁時計時刻が入っている） */
export const BI_DEFAULT_TIME_ZONE = 'Asia/Tokyo';

/** Athena の完了待ちで状態を確認する間隔の既定値（ミリ秒） */
export const BI_ATHENA_POLL_INTERVAL_MS = 500;

/** Athena のクエリを待つ上限の既定値（ミリ秒）。超えたら停止して例外にする */
export const BI_ATHENA_QUERY_TIMEOUT_MS = 120000;

/** Athena のクエリ文字列の上限（バイト）。StartQueryExecution の制約 */
export const BI_ATHENA_MAX_QUERY_BYTES = 262144;

/** Athena の結果を1回に取得する行数の上限（GetQueryResults の制約） */
export const BI_ATHENA_RESULT_PAGE_SIZE = 1000;

/** Athena のクエリの状態（QueryExecutionState） */
export const ATHENA_QUERY_STATE = Object.freeze({
    QUEUED: 'QUEUED',
    RUNNING: 'RUNNING',
    SUCCEEDED: 'SUCCEEDED',
    FAILED: 'FAILED',
    CANCELLED: 'CANCELLED',
} as const);
