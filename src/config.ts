import {
    BI_DEFAULT_ATHENA_CATALOG,
    BI_DEFAULT_RDS_RETENTION_DAYS,
} from './constants.js';
import {BI_ENGINE, isBiEngine} from './engineIds.js';
import type {BiEngine} from './engineIds.js';

/** 設定の項目ごとの環境変数の名前。名前は使う側のリポジトリが決める */
export interface BiQueryConfigNames {
    readonly engine: string;
    readonly athenaWorkGroup: string;
    readonly athenaDatabase: string;
    readonly athenaCatalog: string;
    readonly rdsRetentionDays: string;
}

/** 問い合わせの実行の設定 */
export interface BiQueryConfig {
    /** 設定のエンジン。rds なら常に RDS、athena なら期間で振り分ける */
    readonly engine: BiEngine;
    /** RDS が集計データを保持している日数 */
    readonly rdsRetentionDays: number;
    readonly athena: {
        readonly workGroup: string | null;
        readonly database: string | null;
        readonly catalog: string;
    };
}

export type BiQueryEnv = Readonly<Record<string, string | undefined>>;

const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;

/** 環境変数の値を読む。キーだけ定義されて値が空・空白のときは未設定として扱う */
const readValue = (env: BiQueryEnv, name: string): string | null => {
    const value = (env[name] ?? '').trim();
    return value === '' ? null : value;
};

/** 未知のエンジンは RDS へ黙って戻さず例外にする（切り替わったと誤解したまま運用されるのを防ぐ） */
const readEngine = (env: BiQueryEnv, names: BiQueryConfigNames): BiEngine => {
    const engine = readValue(env, names.engine) ?? BI_ENGINE.RDS;
    if (!isBiEngine(engine)) {
        throw new Error(
            `BI集計の実行エンジン: ${names.engine} が不正です: ${JSON.stringify(
                engine
            )}`
        );
    }
    return engine;
};

const readRetentionDays = (
    env: BiQueryEnv,
    names: BiQueryConfigNames
): number => {
    const value = readValue(env, names.rdsRetentionDays);
    if (value === null) {
        return BI_DEFAULT_RDS_RETENTION_DAYS;
    }
    if (!POSITIVE_INTEGER_PATTERN.test(value)) {
        throw new Error(
            `BI集計の実行エンジン: ${
                names.rdsRetentionDays
            } には正の整数を指定してください: ${JSON.stringify(value)}`
        );
    }
    return Number(value);
};

/**
 * 問い合わせの実行の設定を環境変数から読み、検証する。
 * athena なのにワークグループかデータベースが無いとき、保持日数が正の整数でないときは例外にする
 * @param env 環境変数（通常は process.env）
 * @param names 項目ごとの環境変数の名前
 */
export const readBiQueryConfig = (
    env: BiQueryEnv,
    names: BiQueryConfigNames
): BiQueryConfig => {
    const engine = readEngine(env, names);
    const workGroup = readValue(env, names.athenaWorkGroup);
    const database = readValue(env, names.athenaDatabase);

    if (engine === BI_ENGINE.ATHENA) {
        [
            [workGroup, names.athenaWorkGroup],
            [database, names.athenaDatabase],
        ].forEach(([value, name]) => {
            if (value === null) {
                throw new Error(
                    `BI集計の実行エンジン: ${names.engine}=${BI_ENGINE.ATHENA} のときは ${name} が必要です`
                );
            }
        });
    }

    return {
        engine,
        rdsRetentionDays: readRetentionDays(env, names),
        athena: {
            workGroup,
            database,
            catalog:
                readValue(env, names.athenaCatalog) ??
                BI_DEFAULT_ATHENA_CATALOG,
        },
    };
};
