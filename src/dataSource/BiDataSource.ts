import type {BiQueryEngine} from '../engine/BiQueryEngine.js';
import type {BiEngine} from '../engineIds.js';
import type {EngineSelectionPolicy} from '../policy/EngineSelectionPolicy.js';
import type {BiQuery} from './BiQuery.js';

export interface BiDataSourceOptions {
    /** データソースの識別子（例: sales.aggregation）。エラーとログに出す */
    readonly id: string;
    /** 使えるエンジン（エンジンごとに1つ） */
    readonly engines: readonly BiQueryEngine[];
    /** 実行するエンジンの決め方 */
    readonly policy: EngineSelectionPolicy;
}

/**
 * データソース。呼び出し側はこれだけを使い、どのエンジンで実行されるかを意識しない。
 * 決め方で選んだエンジンの方言でSQLを組み立て、そのエンジンで実行する。
 */
export class BiDataSource {
    readonly id: string;

    private readonly engines: ReadonlyMap<BiEngine, BiQueryEngine>;

    private readonly policy: EngineSelectionPolicy;

    constructor({id, engines, policy}: BiDataSourceOptions) {
        this.id = id;
        this.policy = policy;
        this.engines = engines.reduce((byEngine, engine) => {
            if (byEngine.has(engine.engine)) {
                throw new Error(
                    `BIのデータソース ${id}: エンジン ${engine.engine} が2つ渡されています`
                );
            }
            return byEngine.set(engine.engine, engine);
        }, new Map<BiEngine, BiQueryEngine>());
    }

    /**
     * 問い合わせを実行して行を返す
     * @param query 期間・値・SQLの組み立て方
     */
    async select<Row = Record<string, unknown>>(
        query: BiQuery
    ): Promise<Row[]> {
        const engineId = this.policy.choose(query.period);
        const engine = this.engines.get(engineId);
        if (!engine) {
            throw new Error(
                `BIのデータソース ${this.id}: 実行先のエンジン ${engineId} が設定されていません`
            );
        }
        return engine.select<Row>(
            query.sql(engine.dialect),
            query.params ?? {}
        );
    }
}
