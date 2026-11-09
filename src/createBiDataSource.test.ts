/**
 * 設定からデータソースを組み立てる処理のテスト。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mockClient} from 'aws-sdk-client-mock';
import {
    AthenaClient,
    GetQueryExecutionCommand,
    GetQueryResultsCommand,
    StartQueryExecutionCommand,
} from '@aws-sdk/client-athena';

import {ATHENA_QUERY_STATE} from './constants.js';
import {BI_ENGINE} from './engineIds.js';
import type {BiQueryConfig} from './config.js';
import {createBiDataSource, todayInTimeZone} from './createBiDataSource.js';
import type {RdsSqlRunner} from './engine/BiQueryEngine.js';
import {BI_PERIOD} from './period.js';
import {RDS_DATABASE_TYPE} from './rdsDatabaseType.js';
import type {RdsDatabaseType} from './rdsDatabaseType.js';
import {biSqlDate} from './values.js';
import type {RdsParams} from './values.js';

const DATABASE = 'bi_curated_example';
const TODAY = '2026-11-07';

const athenaMock = mockClient(AthenaClient);

test.beforeEach(() => {
    athenaMock.reset();
    athenaMock.on(StartQueryExecutionCommand).resolves({QueryExecutionId: 'q'});
    athenaMock.on(GetQueryExecutionCommand).resolves({
        QueryExecution: {Status: {State: ATHENA_QUERY_STATE.SUCCEEDED}},
    });
    athenaMock.on(GetQueryResultsCommand).resolves({
        ResultSet: {
            ResultSetMetadata: {
                ColumnInfo: [{Label: 'n', Name: 'n', Type: 'integer'}],
            },
            Rows: [
                {Data: [{VarCharValue: 'n'}]},
                {Data: [{VarCharValue: '2'}]},
            ],
        },
    });
});

const configOf = (engine: BiQueryConfig['engine']): BiQueryConfig => ({
    engine,
    rdsRetentionDays: 30,
    athena: {
        workGroup: 'bi-workgroup',
        database: DATABASE,
        catalog: 'AwsDataCatalog',
    },
});

const createRunner = (
    databaseType: RdsDatabaseType = RDS_DATABASE_TYPE.MYSQL
) => {
    const calls: Array<{sql: string; params: RdsParams}> = [];
    const runner: RdsSqlRunner = {
        databaseType,
        select: async <Row>(sql: string, params: RdsParams) => {
            calls.push({sql, params});
            return [{n: 1}] as unknown as Row[];
        },
    };
    return {runner, calls};
};

const SQL = 'SELECT COUNT(*) AS `n` FROM `aggregation`.`t` WHERE d >= :from';

test('設定がRDSなら、期間に関係なくRDSで実行し、Athenaのクライアントは作らない', async () => {
    const {runner, calls} = createRunner();
    const createdClients: unknown[] = [];
    const dataSource = createBiDataSource({
        id: 'sales.aggregation',
        config: configOf(BI_ENGINE.RDS),
        rdsRunner: runner,
        athena: {
            createClient: () => {
                const client = new AthenaClient({region: 'ap-northeast-1'});
                createdClients.push(client);
                return client;
            },
            schemaAliases: {aggregation: DATABASE},
        },
        today: () => TODAY,
    });

    const rows = await dataSource.select({
        period: BI_PERIOD.ALL_PERIOD,
        params: {from: biSqlDate('2020-01-01')},
        sql: () => SQL,
    });

    assert.equal(dataSource.id, 'sales.aggregation');
    assert.deepEqual(rows, [{n: 1}]);
    assert.deepEqual(calls, [{sql: SQL, params: {from: '2020-01-01'}}]);
    assert.deepEqual(createdClients, []);
});

test('設定がAthenaなら、保持範囲内はRDS、範囲外はスキーマを読み替えてAthenaで実行する', async () => {
    const {runner, calls} = createRunner();
    const dataSource = createBiDataSource({
        id: 'sales.aggregation',
        config: configOf(BI_ENGINE.ATHENA),
        rdsRunner: runner,
        athena: {
            createClient: () => new AthenaClient({region: 'ap-northeast-1'}),
            schemaAliases: {aggregation: DATABASE},
            pollIntervalMs: 0,
        },
        today: () => TODAY,
    });

    await dataSource.select({
        period: {from: '2026-10-08', to: TODAY},
        params: {from: biSqlDate('2026-10-08')},
        sql: () => SQL,
    });
    const athenaRows = await dataSource.select({
        period: {from: '2026-01-01', to: TODAY},
        params: {from: biSqlDate('2026-01-01')},
        sql: () => SQL,
    });

    assert.equal(calls.length, 1);
    assert.deepEqual(athenaRows, [{n: 2}]);
    assert.deepEqual(
        athenaMock.commandCalls(StartQueryExecutionCommand)[0]?.args[0].input
            .QueryString,
        `SELECT COUNT(*) AS "n" FROM "${DATABASE}"."t" WHERE d >= DATE '2026-01-01'`
    );
});

test('設定がAthenaなのに、Athenaの組み立て方が渡されていなければ例外にする', () => {
    assert.throws(
        () =>
            createBiDataSource({
                id: 'sales.aggregation',
                config: configOf(BI_ENGINE.ATHENA),
                rdsRunner: createRunner().runner,
            }),
        /sales\.aggregation.*Athena/
    );
});

test('今日は指定したタイムゾーンの日付で求める', () => {
    const utc = new Date('2026-11-07T15:30:00Z');

    assert.equal(
        todayInTimeZone('Asia/Tokyo', () => utc),
        '2026-11-08'
    );
    assert.equal(
        todayInTimeZone('UTC', () => utc),
        '2026-11-07'
    );
});

test('実行役の DB が PostgreSQL なら、PostgreSQL の書式のSQLとして Athena へ変換する', async () => {
    const {runner, calls} = createRunner(RDS_DATABASE_TYPE.POSTGRES);
    const dataSource = createBiDataSource({
        id: 'sales.aggregation',
        config: configOf(BI_ENGINE.ATHENA),
        rdsRunner: runner,
        athena: {
            createClient: () => new AthenaClient({region: 'ap-northeast-1'}),
            schemaAliases: {aggregation: DATABASE},
            pollIntervalMs: 0,
        },
        today: () => TODAY,
    });
    const sql = 'SELECT COUNT(*) AS "n" FROM aggregation.t WHERE d >= :from';

    await dataSource.select({
        period: {from: '2026-10-08', to: TODAY},
        params: {from: biSqlDate('2026-10-08')},
        sql: () => sql,
    });
    await dataSource.select({
        period: {from: '2026-01-01', to: TODAY},
        params: {from: biSqlDate('2026-01-01')},
        sql: () => sql,
    });

    assert.deepEqual(calls, [{sql, params: {from: '2026-10-08'}}]);
    assert.deepEqual(
        athenaMock.commandCalls(StartQueryExecutionCommand)[0]?.args[0].input
            .QueryString,
        `SELECT COUNT(*) AS "n" FROM "${DATABASE}".t WHERE d >= DATE '2026-01-01'`
    );
});
