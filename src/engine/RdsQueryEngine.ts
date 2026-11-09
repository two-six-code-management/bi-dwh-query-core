import {MySqlDialect} from '../dialect/MySqlDialect.js';
import {PostgresDialect} from '../dialect/PostgresDialect.js';
import type {SqlDialect} from '../dialect/SqlDialect.js';
import {BI_ENGINE} from '../engineIds.js';
import {RDS_DATABASE_TYPE} from '../rdsDatabaseType.js';
import type {RdsDatabaseType} from '../rdsDatabaseType.js';
import {toPlainParams} from '../values.js';
import type {BiParams} from '../values.js';
import type {BiQueryEngine, RdsSqlRunner} from './BiQueryEngine.js';

export interface RdsQueryEngineOptions {
    /** RDS のSQL実行役 */
    readonly runner: RdsSqlRunner;
}

/** RDS の種類ごとの方言 */
const DIALECTS: ReadonlyMap<RdsDatabaseType, () => SqlDialect> = new Map<
    RdsDatabaseType,
    () => SqlDialect
>([
    [RDS_DATABASE_TYPE.MYSQL, () => new MySqlDialect()],
    [RDS_DATABASE_TYPE.POSTGRES, () => new PostgresDialect()],
]);

/**
 * RDS の種類の方言を作る
 * @param databaseType RDS の種類
 */
export const createRdsDialect = (databaseType: RdsDatabaseType): SqlDialect => {
    const create = DIALECTS.get(databaseType);
    if (!create) {
        throw new Error(
            `RDS の実行エンジン: 対応していない RDS の種類です: ${String(
                databaseType
            )}`
        );
    }
    return create();
};

/** RDS（MySQL / PostgreSQL）の実行エンジン。SQLはそのまま、値は素の値へ戻して実行役に渡す */
export class RdsQueryEngine implements BiQueryEngine {
    readonly engine = BI_ENGINE.RDS;

    /** 実行役の RDS の種類で決まる方言 */
    readonly dialect: SqlDialect;

    private readonly runner: RdsSqlRunner;

    constructor({runner}: RdsQueryEngineOptions) {
        this.runner = runner;
        this.dialect = createRdsDialect(runner.databaseType);
    }

    select<Row = Record<string, unknown>>(
        sql: string,
        params: BiParams
    ): Promise<Row[]> {
        return this.runner.select<Row>(sql, toPlainParams(params));
    }
}
