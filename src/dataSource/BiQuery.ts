import type {SqlDialect} from '../dialect/SqlDialect.js';
import type {BiPeriod} from '../period.js';
import type {BiParams} from '../values.js';

/** 1回の問い合わせ */
export interface BiQuery {
    /** 読む期間。実行先のエンジンを決めるのに使う */
    readonly period: BiPeriod;
    /** 名前付きパラメータ（:name）の値。日付・日時は biSqlDate / biSqlTimestamp で渡す */
    readonly params?: BiParams;
    /**
     * SQLを組み立てる。RDS の書式（MySQL は `識別子`、PostgreSQL は "識別子"。パラメータは :name）で書き、エンジンで書き方が違う箇所は方言のメソッドを使う
     * @param dialect 実行先のエンジンの方言
     */
    sql(dialect: SqlDialect): string;
}
