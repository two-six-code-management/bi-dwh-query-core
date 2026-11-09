/**
 * 契約テスト。インターフェースの実装が、どれも同じ約束を守ることを確かめる。
 * 他のシステムが実装を書いたときも、これを呼んで同じ約束を確かめる。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {SQL_DIALECT_METHODS} from '../dialect/SqlDialect.js';
import type {BiQueryEngine} from '../engine/BiQueryEngine.js';
import {isBiEngine} from '../engineIds.js';
import {BI_PERIOD} from '../period.js';
import type {BiPeriod} from '../period.js';
import type {EngineSelectionPolicy} from '../policy/EngineSelectionPolicy.js';
import {biSqlDate, biSqlTimestamp} from '../values.js';

/** 契約テストで返す行 */
export interface ContractRow {
    readonly name: string;
    readonly users: number;
}

export interface BiQueryEngineFixture {
    /** 実行すると、渡した行を返すエンジンを作る */
    createReturning(rows: readonly ContractRow[]): BiQueryEngine;
    /** 実行すると、渡したエラーで失敗するエンジンを作る */
    createFailing(error: Error): BiQueryEngine;
}

const CONTRACT_ROWS: readonly ContractRow[] = Object.freeze([
    {name: 'alpha', users: 3},
    {name: 'beta', users: 1},
]);

const CONTRACT_SQL =
    'SELECT name AS `name`, COUNT(*) AS `users` FROM t WHERE d >= :from AND t < :until AND s IN (:systems) AND x = :x AND y IS :none GROUP BY name';

/**
 * BiQueryEngine の契約テストを定義する
 * @param name 実装の名前
 * @param fixture 実装の作り方
 */
export const defineBiQueryEngineContract = (
    name: string,
    fixture: BiQueryEngineFixture
): void => {
    test(`${name}: エンジンの識別子と、SqlDialect のメソッドをすべて持つ方言を持つ`, () => {
        const engine = fixture.createReturning([]);

        assert.ok(isBiEngine(engine.engine));
        SQL_DIALECT_METHODS.forEach((method) =>
            assert.equal(typeof engine.dialect[method], 'function', method)
        );
    });

    test(`${name}: 日付・日時・配列・数値・NULL の値を受け付け、行の配列を返す`, async () => {
        const rows = await fixture
            .createReturning(CONTRACT_ROWS)
            .select(CONTRACT_SQL, {
                from: biSqlDate('2026-10-01'),
                until: biSqlTimestamp('2026-11-01 00:00:00'),
                systems: ['alpha', 'beta'],
                x: 1,
                none: null,
            });

        assert.deepEqual(rows, CONTRACT_ROWS);
    });

    test(`${name}: 値が無くても実行できる`, async () => {
        const rows = await fixture
            .createReturning(CONTRACT_ROWS)
            .select('SELECT 1', {});

        assert.ok(Array.isArray(rows));
    });

    test(`${name}: 失敗を握りつぶさずに投げる`, async () => {
        const error = new Error('contract failure');

        await assert.rejects(
            () => fixture.createFailing(error).select('SELECT 1', {}),
            /contract failure/
        );
    });
};

/**
 * EngineSelectionPolicy の契約テストを定義する
 * @param name 実装の名前
 * @param createPolicy 実装の作り方
 */
export const defineEngineSelectionPolicyContract = (
    name: string,
    createPolicy: () => EngineSelectionPolicy
): void => {
    test(`${name}: どの期間の種類にもエンジンを返す`, () => {
        const policy = createPolicy();

        [
            {from: '2020-01-01', to: '2020-12-31'},
            BI_PERIOD.CURRENT_STATE,
            BI_PERIOD.ALL_PERIOD,
        ].forEach((period) => assert.ok(isBiEngine(policy.choose(period))));
    });

    test(`${name}: 期間として正しくなければ例外にする`, () => {
        const policy = createPolicy();

        [undefined, null, 'unknown', {to: '2020-12-31'}].forEach((period) =>
            assert.throws(
                () => policy.choose(period as unknown as BiPeriod),
                /period/
            )
        );
    });
};
