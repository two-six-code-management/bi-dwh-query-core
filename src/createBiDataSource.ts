import type {BiQueryConfig} from './config.js';
import {BI_DEFAULT_TIME_ZONE} from './constants.js';
import {BiDataSource} from './dataSource/BiDataSource.js';
import {AthenaQueryEngine} from './engine/AthenaQueryEngine.js';
import type {
    AthenaClientLike,
    AthenaQueryEngineOptions,
} from './engine/AthenaQueryEngine.js';
import type {RdsSqlRunner} from './engine/BiQueryEngine.js';
import {RdsQueryEngine} from './engine/RdsQueryEngine.js';
import {BI_ENGINE} from './engineIds.js';
import {FixedEnginePolicy} from './policy/FixedEnginePolicy.js';
import {RetentionWindowPolicy} from './policy/RetentionWindowPolicy.js';

/** Athena の実行エンジンの組み立て方（設定が athena のときだけ使う） */
export interface BiDataSourceAthenaOptions
    extends Pick<
        AthenaQueryEngineOptions,
        'schemaAliases' | 'pollIntervalMs' | 'timeoutMs' | 'sleep' | 'now'
    > {
    /** Athena のクライアントを作る（設定が rds のときは呼ばない） */
    readonly createClient: () => AthenaClientLike;
}

export interface CreateBiDataSourceOptions {
    /** データソースの識別子（例: sales.aggregation） */
    readonly id: string;
    /** 問い合わせの実行の設定（readBiQueryConfig の戻り値） */
    readonly config: BiQueryConfig;
    /** RDS のSQL実行役。RDS の種類（databaseType）で、方言と Athena へ変換するときのSQLの書式が決まる */
    readonly rdsRunner: RdsSqlRunner;
    /** Athena の実行エンジンの組み立て方。設定が athena のときは必須 */
    readonly athena?: BiDataSourceAthenaOptions;
    /** 今日（YYYY-MM-DD）を返す。省略すると JST の今日 */
    readonly today?: () => string;
}

/**
 * 今日の日付（YYYY-MM-DD）を、指定したタイムゾーンで求める
 * @param timeZone タイムゾーン（IANA）
 * @param now 現在時刻
 */
export const todayInTimeZone = (
    timeZone: string = BI_DEFAULT_TIME_ZONE,
    now: () => Date = () => new Date()
): string =>
    new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(now());

/**
 * 設定からデータソースを組み立てる。
 * 設定が rds なら RDS だけで常に RDS、athena なら RDS と Athena を持ち、RDS の保持範囲で振り分ける
 * @param options 識別子・設定・RDS の実行役・Athena の組み立て方
 */
export const createBiDataSource = ({
    id,
    config,
    rdsRunner,
    athena,
    today = () => todayInTimeZone(),
}: CreateBiDataSourceOptions): BiDataSource => {
    const rdsEngine = new RdsQueryEngine({runner: rdsRunner});
    if (config.engine === BI_ENGINE.RDS) {
        return new BiDataSource({
            id,
            engines: [rdsEngine],
            policy: new FixedEnginePolicy(BI_ENGINE.RDS),
        });
    }
    if (!athena) {
        throw new Error(
            `BIのデータソース ${id}: 設定が Athena なのに、Athena の組み立て方が渡されていません`
        );
    }

    const {createClient, ...engineOptions} = athena;
    return new BiDataSource({
        id,
        engines: [
            rdsEngine,
            new AthenaQueryEngine({
                ...engineOptions,
                client: createClient(),
                sourceSyntax: rdsRunner.databaseType,
                workGroup: config.athena.workGroup as string,
                database: config.athena.database as string,
                catalog: config.athena.catalog,
            }),
        ],
        policy: new RetentionWindowPolicy({
            rdsRetentionDays: config.rdsRetentionDays,
            today,
        }),
    });
};
