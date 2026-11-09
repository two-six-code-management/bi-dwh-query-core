/**
 * PostgreSQL の方言のテスト。
 * どのメソッドも MySQL の方言と同じ結果になる書き方にする。
 * 実際の PostgreSQL での結果は、bi-dwh-query-for-typeorm の結合テストで確かめる。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {PostgresDialect} from './PostgresDialect.js';
import {SQL_DIALECT_METHODS} from './SqlDialect.js';

const postgres = new PostgresDialect();

test('SqlDialect のメソッドをすべて持ち、エンジン名を持たない', () => {
    SQL_DIALECT_METHODS.forEach((method) =>
        assert.equal(typeof postgres[method], 'function', method)
    );
    assert.equal('engine' in postgres, false);
});

test('真偽値のリテラルは TRUE / FALSE', () => {
    assert.equal(postgres.booleanLiteral(true), 'TRUE');
    assert.equal(postgres.booleanLiteral(false), 'FALSE');
});

test('2列の組の重複なし件数は ROW で組にして数える', () => {
    assert.equal(
        postgres.countDistinctPair('f.access_date', 'f.user_id'),
        'COUNT(DISTINCT ROW(f.access_date, f.user_id))'
    );
});

test('GROUP BY は式を並べる（入力の列と同じ名前の別名は、入力の列が優先されるため）', () => {
    assert.equal(
        postgres.groupByColumns([
            {expression: "NULLIF(f.branch_id, '')", alias: 'branchId'},
            {expression: 'f.user_type'},
        ]),
        "NULLIF(f.branch_id, ''), f.user_type"
    );
});

test('条件に当てはまる行の件数は FILTER で数え、条件に当てはまる行があるかは BOOL_OR', () => {
    assert.equal(
        postgres.countIf('c.is_used'),
        'COUNT(*) FILTER (WHERE c.is_used)'
    );
    assert.equal(
        postgres.anyTrue('a.user_id IS NOT NULL'),
        'BOOL_OR(a.user_id IS NOT NULL)'
    );
});

test('重複なしで名前順に連結する: 文字列にしてから STRING_AGG で並べて連結する', () => {
    assert.equal(
        postgres.stringAggDistinctSorted('f.system_name', ','),
        "STRING_AGG(DISTINCT CAST(f.system_name AS text), ',' ORDER BY CAST(f.system_name AS text))"
    );
    assert.equal(
        postgres.stringAggDistinctSorted('f.system_name', "a'b"),
        "STRING_AGG(DISTINCT CAST(f.system_name AS text), 'a''b' ORDER BY CAST(f.system_name AS text))"
    );
});

test('日付・日時の加減算: INTERVAL にパラメータを書けないため、1単位の INTERVAL に掛ける', () => {
    assert.equal(
        postgres.addMinutes('f.slot * :m', 'f.access_date'),
        "(CAST(f.access_date AS timestamp) + (f.slot * :m) * INTERVAL '1 minute')"
    );
    assert.equal(
        postgres.subtractHours('e.started_at', ':hours'),
        "(e.started_at - (:hours) * INTERVAL '1 hour')"
    );
    assert.equal(
        postgres.addDays('e.event_date', ':days'),
        '(CAST(e.event_date AS date) + CAST(:days AS integer))'
    );
});

test('日数の差は日付どうしの引き算', () => {
    assert.equal(
        postgres.dateDiffDays('e.ended_on', 'e.started_on'),
        '(CAST(e.ended_on AS date) - CAST(e.started_on AS date))'
    );
});

test('2つの日時の間の分・秒は、経過秒から求めて0へ向けて切り捨てる（TIMESTAMPDIFF と同じ）', () => {
    assert.equal(
        postgres.minutesBetween('e.started_at', 'e.ended_at'),
        'CAST(TRUNC(EXTRACT(EPOCH FROM (CAST(e.ended_at AS timestamp) - CAST(e.started_at AS timestamp))) / 60) AS bigint)'
    );
    assert.equal(
        postgres.secondsBetween('e.started_at', 'e.ended_at'),
        'CAST(TRUNC(EXTRACT(EPOCH FROM (CAST(e.ended_at AS timestamp) - CAST(e.started_at AS timestamp)))) AS bigint)'
    );
});

test('件数の指定は LIMIT と OFFSET', () => {
    assert.equal(
        postgres.limitOffset(':limit', ':offset'),
        'LIMIT :limit OFFSET :offset'
    );
});

test('今日は JST の日付にする', () => {
    assert.equal(
        postgres.currentDate(),
        "CAST(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tokyo' AS date)"
    );
});

test('型の変換: 小数・日付', () => {
    assert.equal(postgres.asDouble('a.n'), 'CAST(a.n AS double precision)');
    assert.equal(postgres.asDate('a.at'), 'CAST(a.at AS date)');
});

test('文字列を整数にする: 数字だけのときだけ整数にし、他は NULL にする（TRY_CAST が無いため）', () => {
    assert.equal(
        postgres.toInteger('l.target_id'),
        "CASE WHEN TRIM(CAST(l.target_id AS text)) ~ '^[+-]?[0-9]+$' THEN CAST(TRIM(CAST(l.target_id AS text)) AS bigint) END"
    );
});

test('曜日は ISODOW（1=月曜）から1を引き、週の始まりは date_trunc（月曜始まり）', () => {
    assert.equal(
        postgres.weekday('f.access_date'),
        '(CAST(EXTRACT(ISODOW FROM f.access_date) AS integer) - 1)'
    );
    assert.equal(
        postgres.weekStart('f.access_date'),
        "CAST(date_trunc('week', f.access_date) AS date)"
    );
});

test('整数の割り算は / （整数どうしは0へ向けて切り捨て）', () => {
    assert.equal(postgres.integerDivide('a.n', '60'), '(a.n / 60)');
});
