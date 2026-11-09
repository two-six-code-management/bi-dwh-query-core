/**
 * BI集計の問い合わせを、RDS（MySQL / PostgreSQL）と Athena のどちらでも実行できるようにする核。
 * 呼び出し側はデータソース（BiDataSource）と方言のインターフェース（SqlDialect）だけを使い、
 * どのエンジンで実行されるかを意識しない。
 */
export {
    ATHENA_QUERY_STATE,
    BI_ATHENA_MAX_QUERY_BYTES,
    BI_ATHENA_POLL_INTERVAL_MS,
    BI_ATHENA_QUERY_TIMEOUT_MS,
    BI_DEFAULT_ATHENA_CATALOG,
    BI_DEFAULT_RDS_RETENTION_DAYS,
    BI_DEFAULT_TIME_ZONE,
} from './constants.js';
export {BI_ENGINE, isBiEngine} from './engineIds.js';
export type {BiEngine} from './engineIds.js';
export {RDS_DATABASE_TYPE, isRdsDatabaseType} from './rdsDatabaseType.js';
export type {RdsDatabaseType} from './rdsDatabaseType.js';
export {
    BI_PERIOD,
    assertBiPeriod,
    isBiPeriodKind,
    isDateRange,
} from './period.js';
export type {BiPeriod, BiPeriodKind, DateRange} from './period.js';
export {
    BI_SQL_VALUE_TYPE,
    biSqlDate,
    biSqlTimestamp,
    isBiSqlValue,
    toPlainParams,
} from './values.js';
export type {
    BiParamValue,
    BiParams,
    BiSqlValue,
    BiSqlValueType,
    RdsParamValue,
    RdsParams,
} from './values.js';
export {readBiQueryConfig} from './config.js';
export type {BiQueryConfig, BiQueryConfigNames, BiQueryEnv} from './config.js';
export {SQL_DIALECT_METHODS} from './dialect/SqlDialect.js';
export type {GroupByColumn, SqlDialect} from './dialect/SqlDialect.js';
export {MySqlDialect} from './dialect/MySqlDialect.js';
export {PostgresDialect} from './dialect/PostgresDialect.js';
export {TrinoDialect} from './dialect/TrinoDialect.js';
export type {BiQueryEngine, RdsSqlRunner} from './engine/BiQueryEngine.js';
export {RdsQueryEngine, createRdsDialect} from './engine/RdsQueryEngine.js';
export type {RdsQueryEngineOptions} from './engine/RdsQueryEngine.js';
export {AthenaQueryEngine} from './engine/AthenaQueryEngine.js';
export type {
    AthenaClientLike,
    AthenaQueryEngineOptions,
} from './engine/AthenaQueryEngine.js';
export {convertToAthenaSql, toAthenaLiteral} from './engine/athenaSql.js';
export type {AthenaSqlOptions} from './engine/athenaSql.js';
export type {EngineSelectionPolicy} from './policy/EngineSelectionPolicy.js';
export {FixedEnginePolicy} from './policy/FixedEnginePolicy.js';
export {
    RetentionWindowPolicy,
    shiftDays,
} from './policy/RetentionWindowPolicy.js';
export type {RetentionWindowPolicyOptions} from './policy/RetentionWindowPolicy.js';
export type {BiQuery} from './dataSource/BiQuery.js';
export {BiDataSource} from './dataSource/BiDataSource.js';
export type {BiDataSourceOptions} from './dataSource/BiDataSource.js';
export {createBiDataSource, todayInTimeZone} from './createBiDataSource.js';
export type {
    BiDataSourceAthenaOptions,
    CreateBiDataSourceOptions,
} from './createBiDataSource.js';
