import type {SqlDialect} from '../dialect/SqlDialect.js';
import type {BiEngine} from '../engineIds.js';
import type {RdsDatabaseType} from '../rdsDatabaseType.js';
import type {BiParams, RdsParams} from '../values.js';

/** 問い合わせの実行エンジン */
export interface BiQueryEngine {
    /** エンジンの識別子（実行先の判定とログに使う） */
    readonly engine: BiEngine;
    /** このエンジンで実行するSQLの方言 */
    readonly dialect: SqlDialect;
    /**
     * SQLを実行して行を返す
     * @param sql RDS の書式（MySQL は `識別子`、PostgreSQL は "識別子"。パラメータはどちらも :name）で書いたSQL
     * @param params 名前付きパラメータの値
     */
    select<Row = Record<string, unknown>>(
        sql: string,
        params: BiParams
    ): Promise<Row[]>;
}

/**
 * RDS のSQL実行役。各リポジトリが、使っている DB の部品で用意する
 * （bi-dwh-query-for-sequelize・bi-dwh-query-for-typeorm が用意している）。
 */
export interface RdsSqlRunner {
    /** RDS の種類。方言と、Athena へ変換するときのSQLの書式が決まる */
    readonly databaseType: RdsDatabaseType;
    /**
     * SQLを実行して行を返す
     * @param sql RDS のSQL（:name の名前付きパラメータを含む）
     * @param params 名前付きパラメータの値（日付・日時は素の文字列）。値が無いときは空のオブジェクト
     */
    select<Row = Record<string, unknown>>(
        sql: string,
        params: RdsParams
    ): Promise<Row[]>;
}
