/**
 * SQLの方言（MySQL / Trino）のテスト。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {MySqlDialect} from './MySqlDialect.js';
import {TrinoDialect} from './TrinoDialect.js';

const rds = new MySqlDialect();
const athena = new TrinoDialect();

test('エンジン名を持たない（呼び出し側がエンジンで書き分けられないようにする）', () => {
    assert.equal('engine' in rds, false);
    assert.equal('engine' in athena, false);
});

test('2列の組の重複なし件数: Athena は COUNT(DISTINCT a, b) が使えないため ROW で組にする', () => {
    assert.equal(
        rds.countDistinctPair('f.access_date', 'f.user_id'),
        'COUNT(DISTINCT f.access_date, f.user_id)'
    );
    assert.equal(
        athena.countDistinctPair('f.access_date', 'f.user_id'),
        'COUNT(DISTINCT ROW(f.access_date, f.user_id))'
    );
});

test('GROUP BY: RDS は SELECT の別名、Athena は別名を使えないため式で並べる', () => {
    const columns = [
        {expression: "NULLIF(f.branch_id, '')", alias: 'branchId'},
        {expression: 'f.user_type', alias: 'userType'},
    ];

    assert.equal(rds.groupByColumns(columns), '`branchId`, `userType`');
    assert.equal(
        athena.groupByColumns(columns),
        "NULLIF(f.branch_id, ''), f.user_type"
    );
});

test('GROUP BY: 別名の無い列は、RDS でも式のまま並べる', () => {
    const columns = [
        {expression: 'cs.client_type'},
        {expression: "CASE WHEN x >= 1 THEN 'a' ELSE 'b' END", alias: 'tier'},
    ];

    assert.equal(rds.groupByColumns(columns), 'cs.client_type, `tier`');
    assert.equal(
        athena.groupByColumns(columns),
        "cs.client_type, CASE WHEN x >= 1 THEN 'a' ELSE 'b' END"
    );
});

test('条件に当てはまる行の件数: Athena は真偽値を SUM できないため COUNT_IF', () => {
    assert.equal(rds.countIf('customers.isUsed'), 'SUM(customers.isUsed)');
    assert.equal(
        athena.countIf('customers.isUsed'),
        'COUNT_IF(customers.isUsed)'
    );
});

test('条件に当てはまる行があるか: Athena は真偽値の MAX ではなく bool_or', () => {
    assert.equal(
        rds.anyTrue('accesses.user_id IS NOT NULL'),
        'MAX(accesses.user_id IS NOT NULL)'
    );
    assert.equal(
        athena.anyTrue('accesses.user_id IS NOT NULL'),
        'bool_or(accesses.user_id IS NOT NULL)'
    );
});

test('日付に分を足す: Athena は日付に分を足せないため timestamp にしてから足す', () => {
    assert.equal(
        rds.addMinutes('f.slot * :m', 'f.access_date'),
        'TIMESTAMPADD(MINUTE, f.slot * :m, f.access_date)'
    );
    assert.equal(
        athena.addMinutes('f.slot * :m', 'f.access_date'),
        "date_add('minute', f.slot * :m, CAST(f.access_date AS timestamp))"
    );
});

test('日時から時間を引く: Athena は INTERVAL にパラメータを書けないため date_add', () => {
    assert.equal(
        rds.subtractHours('events.startedAt', ':hours'),
        'events.startedAt - INTERVAL :hours HOUR'
    );
    assert.equal(
        athena.subtractHours('events.startedAt', ':hours'),
        "date_add('hour', -(:hours), events.startedAt)"
    );
});

test('日数の差（後の日 − 前の日）: Athena の date_diff は引数の順が DATEDIFF と逆', () => {
    assert.equal(
        rds.dateDiffDays(':baseDate', 'x.lastAccessDate'),
        'DATEDIFF(:baseDate, x.lastAccessDate)'
    );
    assert.equal(
        athena.dateDiffDays(':baseDate', 'x.lastAccessDate'),
        "date_diff('day', x.lastAccessDate, :baseDate)"
    );
});

test('件数と読み飛ばし: Athena（Trino）は OFFSET を LIMIT より前に書く', () => {
    assert.equal(
        rds.limitOffset(':limit', ':offset'),
        'LIMIT :limit OFFSET :offset'
    );
    assert.equal(
        athena.limitOffset(':limit', ':offset'),
        'OFFSET :offset LIMIT :limit'
    );
});

test('今日（JST）: Athena のセッションは UTC のため、JST へ直してから日付にする', () => {
    assert.equal(rds.currentDate(), 'CURDATE()');
    assert.equal(
        athena.currentDate(),
        "CAST(current_timestamp AT TIME ZONE 'Asia/Tokyo' AS date)"
    );
});

test('小数の割り算にする値: Athena は整数同士の割り算が整数になるため double にする', () => {
    assert.equal(rds.asDouble('r.viewed_seconds'), 'r.viewed_seconds');
    assert.equal(
        athena.asDouble('r.viewed_seconds'),
        'CAST(r.viewed_seconds AS double)'
    );
});

test('曜日（0=月曜〜6=日曜）: Athena は day_of_week が 1=月曜〜7=日曜のため1を引く', () => {
    assert.equal(rds.weekday('f.access_date'), 'WEEKDAY(f.access_date)');
    assert.equal(
        athena.weekday('f.access_date'),
        '(day_of_week(f.access_date) - 1)'
    );
});

test('週の月曜の日付: Athena は date_trunc の週が月曜始まり', () => {
    assert.equal(
        rds.weekStart('f.access_date'),
        'DATE_SUB(f.access_date, INTERVAL WEEKDAY(f.access_date) DAY)'
    );
    assert.equal(
        athena.weekStart('f.access_date'),
        "date_trunc('week', f.access_date)"
    );
});

test('整数の割り算（切り捨て）: Athena は DIV が無く、整数同士の / が切り捨てになる', () => {
    assert.equal(
        rds.integerDivide('f.slot', ':slotsPerStep'),
        '(f.slot DIV :slotsPerStep)'
    );
    assert.equal(
        athena.integerDivide('f.slot', ':slotsPerStep'),
        '(f.slot / :slotsPerStep)'
    );
});

test('2つの日時の間の分（切り捨て）: Athena は date_diff で数える', () => {
    assert.equal(
        rds.minutesBetween('r.sharedAt', 'r.firstReadAt'),
        'TIMESTAMPDIFF(MINUTE, r.sharedAt, r.firstReadAt)'
    );
    assert.equal(
        athena.minutesBetween('r.sharedAt', 'r.firstReadAt'),
        "date_diff('minute', r.sharedAt, r.firstReadAt)"
    );
});

test('2つの日時の間の秒（切り捨て）: Athena は date_diff で数える', () => {
    assert.equal(
        rds.secondsBetween('e.started_at', 'e.ended_at'),
        'TIMESTAMPDIFF(SECOND, e.started_at, e.ended_at)'
    );
    assert.equal(
        athena.secondsBetween('e.started_at', 'e.ended_at'),
        "date_diff('second', e.started_at, e.ended_at)"
    );
});

test('日付に日数を足す: Athena は INTERVAL にパラメータを書けないため date_add', () => {
    assert.equal(
        rds.addDays('e.event_date', ':days'),
        'DATE_ADD(e.event_date, INTERVAL :days DAY)'
    );
    assert.equal(
        athena.addDays('e.event_date', ':days'),
        "date_add('day', :days, e.event_date)"
    );
});

test('文字列を整数にする: Athena は数字でない値でエラーにせず NULL にする', () => {
    assert.equal(
        rds.toInteger('il.target_id'),
        'CAST(il.target_id AS UNSIGNED)'
    );
    assert.equal(
        athena.toInteger('il.target_id'),
        'TRY_CAST(il.target_id AS bigint)'
    );
});

test('日時を日付にする: Athena の date_diff は日時を渡すと時刻まで見て数えるため、日付にしてから渡す', () => {
    assert.equal(rds.asDate('cs.contracted_at'), 'cs.contracted_at');
    assert.equal(
        athena.asDate('cs.contracted_at'),
        'CAST(cs.contracted_at AS date)'
    );
});

test('重複なしで名前順に連結する: Athena は GROUP_CONCAT が無いため、配列に集めて並べてから連結する', () => {
    assert.equal(
        rds.stringAggDistinctSorted('f.system_name', ','),
        "GROUP_CONCAT(DISTINCT f.system_name ORDER BY f.system_name SEPARATOR ',')"
    );
    assert.equal(
        athena.stringAggDistinctSorted('f.system_name', ','),
        "array_join(array_sort(array_agg(DISTINCT f.system_name)), ',')"
    );
});
