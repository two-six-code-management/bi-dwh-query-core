/**
 * Athena の実行エンジンのテスト。AthenaClient は aws-sdk-client-mock で差し替え、AWS には接続しない。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mockClient} from 'aws-sdk-client-mock';
import {
    AthenaClient,
    GetQueryExecutionCommand,
    GetQueryResultsCommand,
    StartQueryExecutionCommand,
    StopQueryExecutionCommand,
} from '@aws-sdk/client-athena';

import {BI_ENGINE} from '../engineIds.js';
import {ATHENA_QUERY_STATE} from '../constants.js';
import {TrinoDialect} from '../dialect/TrinoDialect.js';
import {biSqlDate} from '../values.js';
import {AthenaQueryEngine} from './AthenaQueryEngine.js';

const QUERY_EXECUTION_ID = 'query-1';
const WORK_GROUP = 'bi-workgroup';
const DATABASE = 'bi_curated_example';
const CATALOG = 'AwsDataCatalog';
const POLL_INTERVAL_MS = 10;
const TIMEOUT_MS = 100;

const athenaMock = mockClient(AthenaClient);

test.beforeEach(() => {
    athenaMock.reset();
    athenaMock
        .on(StartQueryExecutionCommand)
        .resolves({QueryExecutionId: QUERY_EXECUTION_ID});
});

/** 実行エンジンを作る。待機は記録だけして即座に返し、時計は待機のたびに間隔分だけ進める */
const createEngine = () => {
    const sleeps: number[] = [];
    const clock = {now: 0};
    const engine = new AthenaQueryEngine({
        client: new AthenaClient({region: 'ap-northeast-1'}),
        workGroup: WORK_GROUP,
        database: DATABASE,
        catalog: CATALOG,
        schemaAliases: {aggregation: DATABASE},
        pollIntervalMs: POLL_INTERVAL_MS,
        timeoutMs: TIMEOUT_MS,
        sleep: async (ms) => {
            sleeps.push(ms);
            clock.now += ms;
        },
        now: () => clock.now,
    });
    return {engine, sleeps};
};

const statusOf = (state: string, extra: Record<string, string> = {}) => ({
    QueryExecution: {Status: {State: state, ...extra}},
});

const column = (Label: string, Type: string) => ({
    Label,
    Name: Label.toLowerCase(),
    Type,
});

const row = (...values: Array<string | null>) => ({
    Data: values.map((value) => (value === null ? {} : {VarCharValue: value})),
});

const succeedWith = (columns: ReturnType<typeof column>[], rows: unknown[]) => {
    athenaMock
        .on(GetQueryExecutionCommand)
        .resolves(statusOf(ATHENA_QUERY_STATE.SUCCEEDED) as never);
    athenaMock.on(GetQueryResultsCommand).resolves({
        ResultSet: {ResultSetMetadata: {ColumnInfo: columns}, Rows: rows},
    } as never);
};

test('Athena のエンジンで、Trino の方言を持つ', () => {
    const {engine} = createEngine();

    assert.equal(engine.engine, BI_ENGINE.ATHENA);
    assert.ok(engine.dialect instanceof TrinoDialect);
});

test('SQLを Athena 向けに変換し、ワークグループ・データベース・カタログを指定してクエリを開始し、完了まで待って行を返す', async () => {
    athenaMock
        .on(GetQueryExecutionCommand)
        .resolvesOnce(statusOf(ATHENA_QUERY_STATE.QUEUED) as never)
        .resolvesOnce(statusOf(ATHENA_QUERY_STATE.RUNNING) as never)
        .resolves(statusOf(ATHENA_QUERY_STATE.SUCCEEDED) as never);
    athenaMock.on(GetQueryResultsCommand).resolves({
        ResultSet: {
            ResultSetMetadata: {ColumnInfo: [column('systemName', 'varchar')]},
            Rows: [row('systemName'), row('alpha')],
        },
    } as never);
    const {engine, sleeps} = createEngine();

    const rows = await engine.select(
        'SELECT `s`.name AS `systemName` FROM `aggregation`.`systems` s WHERE d >= :from',
        {from: biSqlDate('2026-10-01')}
    );

    assert.deepEqual(rows, [{systemName: 'alpha'}]);
    assert.deepEqual(
        athenaMock.commandCalls(StartQueryExecutionCommand)[0]?.args[0].input,
        {
            QueryString: `SELECT "s".name AS "systemName" FROM "${DATABASE}"."systems" s WHERE d >= DATE '2026-10-01'`,
            WorkGroup: WORK_GROUP,
            QueryExecutionContext: {Database: DATABASE, Catalog: CATALOG},
        }
    );
    assert.deepEqual(sleeps, [POLL_INTERVAL_MS, POLL_INTERVAL_MS]);
});

test('結果が複数ページに分かれていても、すべての行を返す（先頭行の列名は1ページ目だけ）', async () => {
    athenaMock
        .on(GetQueryExecutionCommand)
        .resolves(statusOf(ATHENA_QUERY_STATE.SUCCEEDED) as never);
    const metadata = {ColumnInfo: [column('id', 'varchar')]};
    athenaMock
        .on(GetQueryResultsCommand, {
            QueryExecutionId: QUERY_EXECUTION_ID,
            NextToken: undefined,
        })
        .resolves({
            ResultSet: {
                ResultSetMetadata: metadata,
                Rows: [row('id'), row('a'), row('b')],
            },
            NextToken: 'page-2',
        } as never)
        .on(GetQueryResultsCommand, {
            QueryExecutionId: QUERY_EXECUTION_ID,
            NextToken: 'page-2',
        })
        .resolves({
            ResultSet: {ResultSetMetadata: metadata, Rows: [row('c')]},
        } as never);
    const {engine} = createEngine();

    const rows = await engine.select('SELECT id FROM t', {});

    assert.deepEqual(rows, [{id: 'a'}, {id: 'b'}, {id: 'c'}]);
    assert.equal(athenaMock.commandCalls(GetQueryResultsCommand).length, 2);
});

test('列の型で値を変換する（整数・小数は数値、booleanは真偽値、日付は文字列、値が無ければnull）', async () => {
    succeedWith(
        [
            column('users', 'bigint'),
            column('slots', 'integer'),
            column('rate', 'double'),
            column('amount', 'decimal'),
            column('isShared', 'boolean'),
            column('accessDate', 'date'),
            column('note', 'varchar'),
        ],
        [
            row(
                'users',
                'slots',
                'rate',
                'amount',
                'isShared',
                'accessDate',
                'note'
            ),
            row('12', '3', '0.25', '10.50', 'true', '2026-11-07', null),
            row(null, null, null, null, 'false', null, ''),
        ]
    );
    const {engine} = createEngine();

    const rows = await engine.select('SELECT ...', {});

    assert.deepEqual(rows, [
        {
            users: 12,
            slots: 3,
            rate: 0.25,
            amount: 10.5,
            isShared: true,
            accessDate: '2026-11-07',
            note: null,
        },
        {
            users: null,
            slots: null,
            rate: null,
            amount: null,
            isShared: false,
            accessDate: null,
            note: '',
        },
    ]);
});

test('クエリが失敗したら、Athenaの理由を付けて例外にする', async () => {
    athenaMock.on(GetQueryExecutionCommand).resolves(
        statusOf(ATHENA_QUERY_STATE.FAILED, {
            StateChangeReason: 'SYNTAX_ERROR: line 1:8',
        }) as never
    );
    const {engine} = createEngine();

    await assert.rejects(
        () => engine.select('SELECT', {}),
        (error: Error) =>
            error.message.includes(ATHENA_QUERY_STATE.FAILED) &&
            error.message.includes('SYNTAX_ERROR: line 1:8') &&
            error.message.includes(QUERY_EXECUTION_ID)
    );
    assert.equal(athenaMock.commandCalls(GetQueryResultsCommand).length, 0);
});

test('クエリが取り消されたら例外にする', async () => {
    athenaMock
        .on(GetQueryExecutionCommand)
        .resolves(statusOf(ATHENA_QUERY_STATE.CANCELLED) as never);
    const {engine} = createEngine();

    await assert.rejects(
        () => engine.select('SELECT 1', {}),
        new RegExp(ATHENA_QUERY_STATE.CANCELLED)
    );
});

test('上限時間を超えても終わらなければ、クエリを停止してから例外にする', async () => {
    athenaMock
        .on(GetQueryExecutionCommand)
        .resolves(statusOf(ATHENA_QUERY_STATE.RUNNING) as never);
    athenaMock.on(StopQueryExecutionCommand).resolves({});
    const {engine, sleeps} = createEngine();

    await assert.rejects(() => engine.select('SELECT 1', {}), /上限時間/);
    assert.deepEqual(
        athenaMock.commandCalls(StopQueryExecutionCommand)[0]?.args[0].input,
        {QueryExecutionId: QUERY_EXECUTION_ID}
    );
    assert.equal(sleeps.length, TIMEOUT_MS / POLL_INTERVAL_MS);
});

test('カタログ・待機の間隔・上限時間を省略すると既定値を使う', async () => {
    succeedWith([column('x', 'integer')], [row('x'), row('1')]);
    const engine = new AthenaQueryEngine({
        client: new AthenaClient({region: 'ap-northeast-1'}),
        workGroup: WORK_GROUP,
        database: DATABASE,
    });

    await engine.select('SELECT 1 AS x', {});

    assert.deepEqual(
        athenaMock.commandCalls(StartQueryExecutionCommand)[0]?.args[0].input
            .QueryExecutionContext,
        {Database: DATABASE, Catalog: CATALOG}
    );
});
