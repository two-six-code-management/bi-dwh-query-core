/**
 * データソースのテスト。決め方で選んだエンジンの方言でSQLを組み立て、そのエンジンで実行する。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {BI_ENGINE} from '../engineIds.js';
import type {BiEngine} from '../engineIds.js';
import {MySqlDialect} from '../dialect/MySqlDialect.js';
import {TrinoDialect} from '../dialect/TrinoDialect.js';
import type {SqlDialect} from '../dialect/SqlDialect.js';
import type {BiQueryEngine} from '../engine/BiQueryEngine.js';
import {BI_PERIOD} from '../period.js';
import {FixedEnginePolicy} from '../policy/FixedEnginePolicy.js';
import {RetentionWindowPolicy} from '../policy/RetentionWindowPolicy.js';
import {biSqlDate} from '../values.js';
import type {BiParams} from '../values.js';
import {BiDataSource} from './BiDataSource.js';

const TODAY = '2026-11-07';

/** 呼び出しを記録する偽のエンジン */
const createFakeEngine = (engine: BiEngine, dialect: SqlDialect) => {
    const calls: Array<{sql: string; params: BiParams}> = [];
    const fake: BiQueryEngine = {
        engine,
        dialect,
        select: async <Row>(sql: string, params: BiParams) => {
            calls.push({sql, params});
            return [{engine}] as unknown as Row[];
        },
    };
    return {fake, calls};
};

const setup = () => {
    const rds = createFakeEngine(BI_ENGINE.RDS, new MySqlDialect());
    const athena = createFakeEngine(BI_ENGINE.ATHENA, new TrinoDialect());
    const dataSource = new BiDataSource({
        id: 'sales.aggregation',
        engines: [rds.fake, athena.fake],
        policy: new RetentionWindowPolicy({
            rdsRetentionDays: 30,
            today: () => TODAY,
        }),
    });
    return {dataSource, rds, athena};
};

test('識別子を持つ', () => {
    assert.equal(setup().dataSource.id, 'sales.aggregation');
});

test('期間がRDSの保持範囲内ならRDSで、範囲外ならAthenaで実行し、値はそのまま渡す', async () => {
    const {dataSource, rds, athena} = setup();
    const params = {from: biSqlDate('2026-10-08')};

    const rdsRows = await dataSource.select({
        period: {from: '2026-10-08', to: TODAY},
        params,
        sql: () => 'SELECT 1',
    });
    const athenaRows = await dataSource.select({
        period: {from: '2026-01-01', to: TODAY},
        params,
        sql: () => 'SELECT 2',
    });

    assert.deepEqual(rdsRows, [{engine: BI_ENGINE.RDS}]);
    assert.deepEqual(athenaRows, [{engine: BI_ENGINE.ATHENA}]);
    assert.deepEqual(rds.calls, [{sql: 'SELECT 1', params}]);
    assert.deepEqual(athena.calls, [{sql: 'SELECT 2', params}]);
});

test('実行先のエンジンの方言でSQLを組み立てる', async () => {
    const {dataSource} = setup();
    const dialects: SqlDialect[] = [];
    const sql = (dialect: SqlDialect) => {
        dialects.push(dialect);
        return 'SELECT 1';
    };

    await dataSource.select({period: BI_PERIOD.CURRENT_STATE, sql});
    await dataSource.select({period: BI_PERIOD.ALL_PERIOD, sql});

    assert.ok(dialects[0] instanceof MySqlDialect);
    assert.ok(dialects[1] instanceof TrinoDialect);
});

test('値を省略すると空のオブジェクトで実行する', async () => {
    const {dataSource, rds} = setup();

    await dataSource.select({
        period: BI_PERIOD.CURRENT_STATE,
        sql: () => 'SELECT 1',
    });

    assert.deepEqual(rds.calls[0]?.params, {});
});

test('Athenaで失敗したら、RDSへ切り替えずに例外をそのまま投げる', async () => {
    const rds = createFakeEngine(BI_ENGINE.RDS, new MySqlDialect());
    const dataSource = new BiDataSource({
        id: 'sales.aggregation',
        engines: [
            rds.fake,
            {
                engine: BI_ENGINE.ATHENA,
                dialect: new TrinoDialect(),
                select: async () => {
                    throw new Error('athena failed');
                },
            },
        ],
        policy: new FixedEnginePolicy(BI_ENGINE.ATHENA),
    });

    await assert.rejects(
        () =>
            dataSource.select({
                period: BI_PERIOD.ALL_PERIOD,
                sql: () => 'SELECT 1',
            }),
        /athena failed/
    );
    assert.deepEqual(rds.calls, []);
});

test('決め方が選んだエンジンが無ければ、データソースの設定の誤りとして例外にする', async () => {
    const rds = createFakeEngine(BI_ENGINE.RDS, new MySqlDialect());
    const dataSource = new BiDataSource({
        id: 'sales.aggregation',
        engines: [rds.fake],
        policy: new FixedEnginePolicy(BI_ENGINE.ATHENA),
    });

    await assert.rejects(
        () =>
            dataSource.select({
                period: BI_PERIOD.ALL_PERIOD,
                sql: () => 'SELECT 1',
            }),
        /sales\.aggregation.*athena/
    );
});

test('同じエンジンを2つ渡したら、作るときに例外にする', () => {
    const rds = createFakeEngine(BI_ENGINE.RDS, new MySqlDialect());

    assert.throws(
        () =>
            new BiDataSource({
                id: 'x',
                engines: [rds.fake, rds.fake],
                policy: new FixedEnginePolicy(BI_ENGINE.RDS),
            }),
        /rds/
    );
});
