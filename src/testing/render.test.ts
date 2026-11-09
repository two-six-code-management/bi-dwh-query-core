/**
 * 呼び出し側のテスト用に、問い合わせを各エンジンのSQLにする処理のテスト。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import type {SqlDialect} from '../dialect/SqlDialect.js';
import {RDS_DATABASE_TYPE} from '../rdsDatabaseType.js';
import {biSqlDate} from '../values.js';
import {renderAthenaSql, renderRdsQuery} from './render.js';

const query = {
    params: {from: biSqlDate('2026-10-01')},
    sql: (dialect: SqlDialect) =>
        `SELECT ${dialect.booleanLiteral(
            true
        )} AS "ok" FROM aggregation.t WHERE d >= :from`,
};

test('RDS の種類を省略すると MySQL の方言で組み立て、値は素の値にする', () => {
    assert.deepEqual(renderRdsQuery(query), {
        sql: 'SELECT 1 AS "ok" FROM aggregation.t WHERE d >= :from',
        params: {from: '2026-10-01'},
    });
});

test('PostgreSQL を指定すると PostgreSQL の方言で組み立てる', () => {
    assert.equal(
        renderRdsQuery(query, RDS_DATABASE_TYPE.POSTGRES).sql,
        'SELECT TRUE AS "ok" FROM aggregation.t WHERE d >= :from'
    );
});

test('Athena のSQLは、指定した書式から変換してスキーマを読み替える', () => {
    assert.equal(
        renderAthenaSql(query, {
            schemaAliases: {aggregation: 'bi_curated_example'},
            sourceSyntax: RDS_DATABASE_TYPE.POSTGRES,
        }),
        `SELECT TRUE AS "ok" FROM "bi_curated_example".t WHERE d >= DATE '2026-10-01'`
    );
});
