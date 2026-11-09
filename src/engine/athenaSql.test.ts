/**
 * RDS の書式（MySQL / PostgreSQL）で書いたSQLを、Athena（Trino）で実行できる形へ変換する処理のテスト。
 * スキーマの読み替えは、固定の aggregation ではなく設定（schemaAliases）で渡す。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {BI_ATHENA_MAX_QUERY_BYTES} from '../constants.js';
import {RDS_DATABASE_TYPE} from '../rdsDatabaseType.js';
import {biSqlDate, biSqlTimestamp} from '../values.js';
import type {BiParams} from '../values.js';
import {convertToAthenaSql, toAthenaLiteral} from './athenaSql.js';

const DATABASE = 'bi_curated_example';
const SCHEMA_ALIASES = Object.freeze({aggregation: DATABASE});

const convert = (sql: string, params: BiParams = {}) =>
    convertToAthenaSql(sql, params, {schemaAliases: SCHEMA_ALIASES});

test('値をAthenaのリテラルにする', () => {
    assert.equal(toAthenaLiteral('alpha'), "'alpha'");
    assert.equal(toAthenaLiteral("O'Reilly"), "'O''Reilly'");
    assert.equal(toAthenaLiteral('a\\b'), "'a\\b'");
    assert.equal(toAthenaLiteral(30), '30');
    assert.equal(toAthenaLiteral(-1.5), '-1.5');
    assert.equal(toAthenaLiteral(true), 'TRUE');
    assert.equal(toAthenaLiteral(false), 'FALSE');
    assert.equal(toAthenaLiteral(null), 'NULL');
    assert.equal(toAthenaLiteral(biSqlDate('2026-11-07')), "DATE '2026-11-07'");
    assert.equal(
        toAthenaLiteral(biSqlTimestamp('2026-11-07 09:30:00')),
        "TIMESTAMP '2026-11-07 09:30:00'"
    );
});

test('配列は要素をカンマ区切りにし、空配列はNULLにする（SequelizeのIN展開と同じ）', () => {
    assert.equal(toAthenaLiteral(['a', 'b']), "'a', 'b'");
    assert.equal(toAthenaLiteral([1, 2, 3]), '1, 2, 3');
    assert.equal(toAthenaLiteral([]), 'NULL');
    assert.equal(toAthenaLiteral([['a', 1]]), "('a', 1)");
});

test('リテラルにできない値は例外にする', () => {
    [NaN, Infinity, new Date(), {a: 1}, undefined].forEach((value) => {
        assert.throws(
            () => toAthenaLiteral(value as never),
            Error,
            String(value)
        );
    });
});

test('名前付きパラメータを値のリテラルへ置き換える', () => {
    assert.equal(
        convert(
            'SELECT * FROM t WHERE d >= :from AND d <= :to AND s IN (:systems) LIMIT :limit',
            {
                from: biSqlDate('2026-10-01'),
                to: biSqlDate('2026-10-31'),
                systems: ['alpha', 'beta'],
                limit: 10,
            }
        ),
        "SELECT * FROM t WHERE d >= DATE '2026-10-01' AND d <= DATE '2026-10-31' AND s IN ('alpha', 'beta') LIMIT 10"
    );
});

test('同じパラメータを何度使っても、それぞれ置き換える', () => {
    assert.equal(
        convert('SELECT :x AS a, :x AS b', {x: 1}),
        'SELECT 1 AS a, 1 AS b'
    );
});

test('値が渡されていないパラメータは例外にする（Sequelizeと同じ）', () => {
    assert.throws(() => convert('SELECT :missing', {}), /missing/);
});

test('文字列リテラル・コメントの中のコロンやバッククォートは置き換えない', () => {
    assert.equal(
        convert(
            "SELECT '10:30' AS t, 'it''s `x` :y' AS s /* :z `w` */ FROM tbl -- :c\nWHERE a = :a",
            {a: 1}
        ),
        "SELECT '10:30' AS t, 'it''s `x` :y' AS s /* :z `w` */ FROM tbl -- :c\nWHERE a = 1"
    );
});

test('バッククォートの識別子はダブルクォートにする', () => {
    assert.equal(
        convert('SELECT COUNT(*) AS `userDays`, l.`system` FROM t l'),
        'SELECT COUNT(*) AS "userDays", l."system" FROM t l'
    );
    assert.equal(convert('SELECT 1 AS `a"b`'), 'SELECT 1 AS "a""b"');
    assert.equal(convert('SELECT 1 AS `a``b`'), 'SELECT 1 AS "a`b"');
});

test('設定したスキーマで修飾したテーブルは、Athenaのデータベースへ読み替える', () => {
    assert.equal(
        convert(
            'SELECT * FROM `aggregation`.`customers` cs JOIN `aggregation`.`access_logs` f ON 1 = 1'
        ),
        `SELECT * FROM "${DATABASE}"."customers" cs JOIN "${DATABASE}"."access_logs" f ON 1 = 1`
    );
});

test('読み替えるスキーマは複数指定でき、指定していないスキーマはそのまま残す', () => {
    assert.equal(
        convertToAthenaSql(
            'SELECT * FROM `a`.`t1` JOIN `b`.`t2` ON 1 = 1 JOIN `c`.`t3` ON 1 = 1',
            {},
            {schemaAliases: {a: 'db_a', b: 'db_b'}}
        ),
        'SELECT * FROM "db_a"."t1" JOIN "db_b"."t2" ON 1 = 1 JOIN "c"."t3" ON 1 = 1'
    );
});

test('スキーマと同じ名前でも、修飾に使っていない識別子は読み替えない', () => {
    assert.equal(
        convert('SELECT 1 AS `aggregation`'),
        'SELECT 1 AS "aggregation"'
    );
});

test('PostgreSQLのキャスト(::)はパラメータとして扱わない', () => {
    assert.equal(
        convert('SELECT a::varchar FROM t'),
        'SELECT a::varchar FROM t'
    );
});

test('変換後のSQLがAthenaの上限を超えたら例外にする', () => {
    const ids = Array.from(
        {length: BI_ATHENA_MAX_QUERY_BYTES / 8},
        (_, i) => `id-${i}`
    );
    assert.throws(
        () => convert('SELECT * FROM t WHERE id IN (:ids)', {ids}),
        /上限/
    );
});

test('囲まずにスキーマで修飾したテーブルも、Athenaのデータベースへ読み替える', () => {
    assert.equal(
        convert(
            'SELECT a.aggregation, a.n FROM aggregation.access_logs a JOIN aggregation.`users` u ON 1 = 1'
        ),
        `SELECT a.aggregation, a.n FROM "${DATABASE}".access_logs a JOIN "${DATABASE}"."users" u ON 1 = 1`
    );
});

const convertPostgres = (sql: string, params: BiParams = {}) =>
    convertToAthenaSql(sql, params, {
        schemaAliases: SCHEMA_ALIASES,
        sourceSyntax: RDS_DATABASE_TYPE.POSTGRES,
    });

test('PostgreSQL の書式: ダブルクォートの識別子はそのまま、パラメータはリテラルにする', () => {
    assert.equal(
        convertPostgres(
            'SELECT u."name" AS "userName" FROM t u WHERE d >= :from AND s IN (:systems)',
            {from: biSqlDate('2026-10-01'), systems: ['alpha', 'beta']}
        ),
        `SELECT u."name" AS "userName" FROM t u WHERE d >= DATE '2026-10-01' AND s IN ('alpha', 'beta')`
    );
    assert.equal(convertPostgres('SELECT 1 AS "a""b"'), 'SELECT 1 AS "a""b"');
});

test('PostgreSQL の書式: スキーマで修飾したテーブルは、囲んでも囲まなくても読み替える', () => {
    assert.equal(
        convertPostgres(
            'SELECT * FROM "aggregation"."customers" c JOIN aggregation.access_logs a ON 1 = 1'
        ),
        `SELECT * FROM "${DATABASE}"."customers" c JOIN "${DATABASE}".access_logs a ON 1 = 1`
    );
    assert.equal(
        convertPostgres('SELECT 1 AS "aggregation"'),
        'SELECT 1 AS "aggregation"'
    );
});

test('PostgreSQL の書式: 文字列の中のバックスラッシュはエスケープとして読まない', () => {
    assert.equal(
        convertPostgres("SELECT 'C:\\' AS p, :n AS n, ':n' AS s", {n: 1}),
        "SELECT 'C:\\' AS p, 1 AS n, ':n' AS s"
    );
});

test('PostgreSQL の書式: Athena は :: のキャストを使えないため、CAST で書くよう例外にする', () => {
    assert.throws(
        () => convertPostgres('SELECT a::date FROM t'),
        /CAST\(… AS …\)/
    );
    assert.equal(
        convertPostgres("SELECT CAST(a AS date), 'x::y' FROM t"),
        "SELECT CAST(a AS date), 'x::y' FROM t"
    );
});
