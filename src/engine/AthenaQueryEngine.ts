import {
    GetQueryExecutionCommand,
    GetQueryResultsCommand,
    StartQueryExecutionCommand,
    StopQueryExecutionCommand,
} from '@aws-sdk/client-athena';
import type {
    ColumnInfo,
    GetQueryExecutionCommandOutput,
    GetQueryResultsCommandOutput,
    QueryExecutionStatus,
    Row as AthenaRow,
    StartQueryExecutionCommandOutput,
} from '@aws-sdk/client-athena';

import {
    ATHENA_QUERY_STATE,
    BI_ATHENA_POLL_INTERVAL_MS,
    BI_ATHENA_QUERY_TIMEOUT_MS,
    BI_ATHENA_RESULT_PAGE_SIZE,
    BI_DEFAULT_ATHENA_CATALOG,
} from '../constants.js';
import type {SqlDialect} from '../dialect/SqlDialect.js';
import {TrinoDialect} from '../dialect/TrinoDialect.js';
import {BI_ENGINE} from '../engineIds.js';
import {RDS_DATABASE_TYPE} from '../rdsDatabaseType.js';
import type {RdsDatabaseType} from '../rdsDatabaseType.js';
import type {BiParams} from '../values.js';
import {convertToAthenaSql} from './athenaSql.js';
import type {BiQueryEngine} from './BiQueryEngine.js';

/** Athena のクライアントのうち、このエンジンが使う部分（AthenaClient をそのまま渡せる） */
export interface AthenaClientLike {
    send(
        command: StartQueryExecutionCommand
    ): Promise<StartQueryExecutionCommandOutput>;
    send(
        command: GetQueryExecutionCommand
    ): Promise<GetQueryExecutionCommandOutput>;
    send(
        command: GetQueryResultsCommand
    ): Promise<GetQueryResultsCommandOutput>;
    send(command: StopQueryExecutionCommand): Promise<unknown>;
}

export interface AthenaQueryEngineOptions {
    readonly client: AthenaClientLike;
    /** ワークグループ（結果の保存先・暗号化・読み取り量の上限はワークグループの設定が強制される） */
    readonly workGroup: string;
    /** 修飾の無いテーブルを読むデータベース */
    readonly database: string;
    /** データカタログ。省略すると AwsDataCatalog */
    readonly catalog?: string;
    /** 読み替えるスキーマ（RDS のスキーマ名 → Athena のデータベース） */
    readonly schemaAliases?: Readonly<Record<string, string>>;
    /** 渡されるSQLの書式（RDS の種類）。省略すると MySQL */
    readonly sourceSyntax?: RdsDatabaseType;
    /** 完了待ちで状態を確認する間隔（ミリ秒） */
    readonly pollIntervalMs?: number;
    /** 待つ上限（ミリ秒）。超えたらクエリを停止して例外にする */
    readonly timeoutMs?: number;
    /** 待機（テストで差し替える） */
    readonly sleep?: (ms: number) => Promise<void>;
    /** 現在時刻（ミリ秒。テストで差し替える） */
    readonly now?: () => number;
}

/** 数値として返す列の型（Athena の ColumnInfo.Type） */
const NUMERIC_TYPES: ReadonlySet<string> = new Set([
    'tinyint',
    'smallint',
    'integer',
    'bigint',
    'float',
    'real',
    'double',
    'decimal',
]);

const BOOLEAN_TYPE = 'boolean';
const BOOLEAN_TRUE = 'true';

type Converter = (value: string) => unknown;

interface ResultColumn {
    readonly label: string;
    readonly convert: Converter;
}

/** 列の型から、文字列で返る値の変換方法を選ぶ。数値は RDS の結果と同じく数値で返す */
const converterFor = (type: string | undefined): Converter => {
    if (type !== undefined && NUMERIC_TYPES.has(type)) {
        return Number;
    }
    return type === BOOLEAN_TYPE
        ? (value) => value === BOOLEAN_TRUE
        : (value) => value;
};

/** 結果の行（Datum の配列）をオブジェクトにする。値が無い（NULL）ものは null */
const toRecord = (
    columns: readonly ResultColumn[],
    row: AthenaRow
): Record<string, unknown> =>
    Object.fromEntries(
        columns.map(({label, convert}, index) => {
            const value = row.Data?.[index]?.VarCharValue;
            return [label, value === undefined ? null : convert(value)];
        })
    );

const toResultColumns = (columnInfo: readonly ColumnInfo[]): ResultColumn[] =>
    columnInfo.map(({Label, Name, Type}) => ({
        label: Label ?? Name ?? '',
        convert: converterFor(Type),
    }));

/** クエリの状態ごとの処理 */
type StateHandler = (
    queryExecutionId: string,
    startedAt: number,
    status: QueryExecutionStatus
) => Promise<void>;

const defaultSleep = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Athena の実行エンジン。SQLを Athena 向けに変換し、実行して結果を待ち、全ページを取って型を変換する。
 * Athena で失敗しても RDS へは切り替えない（誤った期間のデータを黙って返さないため）。
 */
export class AthenaQueryEngine implements BiQueryEngine {
    readonly engine = BI_ENGINE.ATHENA;

    readonly dialect: SqlDialect = new TrinoDialect();

    private readonly client: AthenaClientLike;

    private readonly workGroup: string;

    private readonly database: string;

    private readonly catalog: string;

    private readonly schemaAliases: Readonly<Record<string, string>>;

    private readonly sourceSyntax: RdsDatabaseType;

    private readonly pollIntervalMs: number;

    private readonly timeoutMs: number;

    private readonly sleep: (ms: number) => Promise<void>;

    private readonly now: () => number;

    constructor({
        client,
        workGroup,
        database,
        catalog = BI_DEFAULT_ATHENA_CATALOG,
        schemaAliases = {},
        sourceSyntax = RDS_DATABASE_TYPE.MYSQL,
        pollIntervalMs = BI_ATHENA_POLL_INTERVAL_MS,
        timeoutMs = BI_ATHENA_QUERY_TIMEOUT_MS,
        sleep = defaultSleep,
        now = Date.now,
    }: AthenaQueryEngineOptions) {
        this.client = client;
        this.workGroup = workGroup;
        this.database = database;
        this.catalog = catalog;
        this.schemaAliases = schemaAliases;
        this.sourceSyntax = sourceSyntax;
        this.pollIntervalMs = pollIntervalMs;
        this.timeoutMs = timeoutMs;
        this.sleep = sleep;
        this.now = now;
    }

    async select<Row = Record<string, unknown>>(
        sql: string,
        params: BiParams
    ): Promise<Row[]> {
        const {QueryExecutionId} = await this.client.send(
            new StartQueryExecutionCommand({
                QueryString: convertToAthenaSql(sql, params, {
                    schemaAliases: this.schemaAliases,
                    sourceSyntax: this.sourceSyntax,
                }),
                WorkGroup: this.workGroup,
                QueryExecutionContext: {
                    Database: this.database,
                    Catalog: this.catalog,
                },
            })
        );
        const queryExecutionId = QueryExecutionId as string;
        await this.waitForCompletion(queryExecutionId, this.now());
        return (await this.fetchRecords(queryExecutionId)) as Row[];
    }

    /** 完了まで待つ。失敗・取消しは Athena の理由を付けて例外、上限時間を超えたら停止して例外 */
    private async waitForCompletion(
        queryExecutionId: string,
        startedAt: number
    ): Promise<void> {
        const {QueryExecution} = await this.client.send(
            new GetQueryExecutionCommand({QueryExecutionId: queryExecutionId})
        );
        const status: QueryExecutionStatus = QueryExecution?.Status ?? {};
        const handler =
            this.handlerByState.get(status.State ?? '') ?? this.waitOrTimeout;
        return handler(queryExecutionId, startedAt, status);
    }

    /** 状態ごとの処理。完了なら終わり、失敗・取消しは例外、それ以外は待つ */
    private readonly handlerByState: ReadonlyMap<string, StateHandler> =
        new Map<string, StateHandler>([
            [ATHENA_QUERY_STATE.SUCCEEDED, async () => undefined],
            [
                ATHENA_QUERY_STATE.FAILED,
                async (id: string, _: number, status: QueryExecutionStatus) =>
                    this.fail(id, status),
            ],
            [
                ATHENA_QUERY_STATE.CANCELLED,
                async (id: string, _: number, status: QueryExecutionStatus) =>
                    this.fail(id, status),
            ],
        ]);

    private fail(
        queryExecutionId: string,
        status: QueryExecutionStatus
    ): never {
        throw new Error(
            `Athenaのクエリが${
                status.State
            }になりました（QueryExecutionId: ${queryExecutionId}）: ${
                status.StateChangeReason ?? '理由なし'
            }`
        );
    }

    private readonly waitOrTimeout = async (
        queryExecutionId: string,
        startedAt: number
    ): Promise<void> => {
        if (this.now() - startedAt >= this.timeoutMs) {
            await this.client.send(
                new StopQueryExecutionCommand({
                    QueryExecutionId: queryExecutionId,
                })
            );
            throw new Error(
                `Athenaのクエリが上限時間（${this.timeoutMs}ミリ秒）を超えたため停止しました（QueryExecutionId: ${queryExecutionId}）`
            );
        }
        await this.sleep(this.pollIntervalMs);
        return this.waitForCompletion(queryExecutionId, startedAt);
    };

    /** 結果を NextToken が無くなるまで取得する。1ページ目の先頭行は列名なので除く */
    private async fetchRecords(
        queryExecutionId: string,
        nextToken?: string,
        columns?: readonly ResultColumn[],
        records: Record<string, unknown>[] = []
    ): Promise<Record<string, unknown>[]> {
        const {ResultSet, NextToken} = await this.client.send(
            new GetQueryResultsCommand({
                QueryExecutionId: queryExecutionId,
                MaxResults: BI_ATHENA_RESULT_PAGE_SIZE,
                ...(nextToken ? {NextToken: nextToken} : {}),
            })
        );
        const isFirstPage = columns === undefined;
        const resolvedColumns =
            columns ??
            toResultColumns(ResultSet?.ResultSetMetadata?.ColumnInfo ?? []);
        const rows = ResultSet?.Rows ?? [];
        const accumulated = [
            ...records,
            ...(isFirstPage ? rows.slice(1) : rows).map((row) =>
                toRecord(resolvedColumns, row)
            ),
        ];

        return NextToken
            ? this.fetchRecords(
                  queryExecutionId,
                  NextToken,
                  resolvedColumns,
                  accumulated
              )
            : accumulated;
    }
}
