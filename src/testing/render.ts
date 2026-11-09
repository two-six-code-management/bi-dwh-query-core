import type {BiQuery} from '../dataSource/BiQuery.js';
import {TrinoDialect} from '../dialect/TrinoDialect.js';
import {convertToAthenaSql} from '../engine/athenaSql.js';
import type {AthenaSqlOptions} from '../engine/athenaSql.js';
import {createRdsDialect} from '../engine/RdsQueryEngine.js';
import {RDS_DATABASE_TYPE} from '../rdsDatabaseType.js';
import type {RdsDatabaseType} from '../rdsDatabaseType.js';
import {toPlainParams} from '../values.js';
import type {RdsParams} from '../values.js';

/**
 * 問い合わせを、Athena で実行するときのSQLにする（呼び出し側のテスト用。AWS には接続しない）
 * @param query 問い合わせ
 * @param options スキーマの読み替えと、SQLの書式（RDS の種類。省略すると MySQL）
 */
export const renderAthenaSql = (
    query: Pick<BiQuery, 'sql' | 'params'>,
    options: AthenaSqlOptions = {}
): string =>
    convertToAthenaSql(
        query.sql(new TrinoDialect()),
        query.params ?? {},
        options
    );

/**
 * 問い合わせを、RDS の実行役へ渡すSQLと値にする（呼び出し側のテスト用）
 * @param query 問い合わせ
 * @param databaseType RDS の種類。省略すると MySQL
 */
export const renderRdsQuery = (
    query: Pick<BiQuery, 'sql' | 'params'>,
    databaseType: RdsDatabaseType = RDS_DATABASE_TYPE.MYSQL
): {sql: string; params: RdsParams} => ({
    sql: query.sql(createRdsDialect(databaseType)),
    params: toPlainParams(query.params ?? {}),
});
