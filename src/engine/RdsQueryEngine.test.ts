/**
 * RDS の実行エンジンのテスト。RDS のSQL実行役（RdsSqlRunner）は記録するだけの偽物にする。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {BI_ENGINE} from '../engineIds.js';
import {MySqlDialect} from '../dialect/MySqlDialect.js';
import {PostgresDialect} from '../dialect/PostgresDialect.js';
import {RDS_DATABASE_TYPE} from '../rdsDatabaseType.js';
import type {RdsDatabaseType} from '../rdsDatabaseType.js';
import {biSqlDate, biSqlTimestamp} from '../values.js';
import type {RdsParams} from '../values.js';
import {RdsQueryEngine} from './RdsQueryEngine.js';
import type {RdsSqlRunner} from './BiQueryEngine.js';

const ROWS = Object.freeze([{users: 1}]);

const createRunner = (
    databaseType: RdsDatabaseType = RDS_DATABASE_TYPE.MYSQL
) => {
    const calls: Array<{sql: string; params: RdsParams}> = [];
    const runner: RdsSqlRunner = {
        databaseType,
        select: async <Row>(sql: string, params: RdsParams) => {
            calls.push({sql, params});
            return ROWS as unknown as Row[];
        },
    };
    return {runner, calls};
};

test('RDS のエンジンで、実行役の DB が MySQL なら MySQL の方言を持つ', () => {
    const engine = new RdsQueryEngine({runner: createRunner().runner});

    assert.equal(engine.engine, BI_ENGINE.RDS);
    assert.ok(engine.dialect instanceof MySqlDialect);
});

test('実行役の DB が PostgreSQL なら PostgreSQL の方言を持つ', () => {
    const engine = new RdsQueryEngine({
        runner: createRunner(RDS_DATABASE_TYPE.POSTGRES).runner,
    });

    assert.ok(engine.dialect instanceof PostgresDialect);
});

test('実行役の DB の種類が分からなければ例外にする', () => {
    assert.throws(
        () =>
            new RdsQueryEngine({
                runner: {
                    ...createRunner().runner,
                    databaseType: 'oracle' as unknown as RdsDatabaseType,
                },
            }),
        /oracle/
    );
});

test('SQLはそのまま、型付きの値は素の値へ戻して実行役に渡し、行を返す', async () => {
    const {runner, calls} = createRunner();
    const engine = new RdsQueryEngine({runner});
    const sql = 'SELECT COUNT(*) AS `users` FROM t WHERE d >= :from';

    const rows = await engine.select(sql, {
        from: biSqlDate('2026-10-01'),
        until: biSqlTimestamp('2026-11-01 00:00:00'),
        ids: ['a', 'b'],
    });

    assert.deepEqual(rows, ROWS);
    assert.deepEqual(calls, [
        {
            sql,
            params: {
                from: '2026-10-01',
                until: '2026-11-01 00:00:00',
                ids: ['a', 'b'],
            },
        },
    ]);
});

test('値が無いときは空のオブジェクトを渡す（何を省くかは実行役が決める）', async () => {
    const {runner, calls} = createRunner();

    await new RdsQueryEngine({runner}).select('SELECT 1', {});

    assert.deepEqual(calls[0]?.params, {});
});

test('実行役の失敗は握りつぶさずにそのまま投げる', async () => {
    const engine = new RdsQueryEngine({
        runner: {
            databaseType: RDS_DATABASE_TYPE.MYSQL,
            select: async () => {
                throw new Error('rds failed');
            },
        },
    });

    await assert.rejects(() => engine.select('SELECT 1', {}), /rds failed/);
});
