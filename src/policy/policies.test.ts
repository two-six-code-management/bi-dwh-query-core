/**
 * 実行先の決め方のテスト。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {BI_ENGINE} from '../engineIds.js';
import {BI_PERIOD} from '../period.js';
import type {BiPeriod} from '../period.js';
import {FixedEnginePolicy} from './FixedEnginePolicy.js';
import {RetentionWindowPolicy, shiftDays} from './RetentionWindowPolicy.js';

const TODAY = '2026-11-07';
const RETENTION_DAYS = 30;
/** 今日から保持日数だけ遡った日。これ以降の期間はRDSに全部ある */
const RETENTION_START = '2026-10-08';

const retention = new RetentionWindowPolicy({
    rdsRetentionDays: RETENTION_DAYS,
    today: () => TODAY,
});

test('固定: 期間に関係なく、指定したエンジンで実行する', () => {
    const fixed = new FixedEnginePolicy(BI_ENGINE.RDS);

    [
        {from: '2020-01-01', to: TODAY},
        BI_PERIOD.ALL_PERIOD,
        BI_PERIOD.CURRENT_STATE,
    ].forEach((period) => {
        assert.equal(fixed.choose(period), BI_ENGINE.RDS);
    });
});

test('保持範囲: 期間の開始がRDSの保持範囲内なら、当日を含んでもRDSで実行する', () => {
    assert.equal(
        retention.choose({from: RETENTION_START, to: TODAY}),
        BI_ENGINE.RDS
    );
    assert.equal(retention.choose({from: TODAY, to: TODAY}), BI_ENGINE.RDS);
});

test('保持範囲: 期間の開始がRDSの保持範囲より前なら、Athenaで実行する', () => {
    assert.equal(
        retention.choose({from: '2026-10-07', to: TODAY}),
        BI_ENGINE.ATHENA
    );
    assert.equal(
        retention.choose({from: '2025-01-01', to: '2025-12-31'}),
        BI_ENGINE.ATHENA
    );
});

test('保持範囲: 今の状態だけを読むSQLはRDS、全期間を読むSQLはAthenaで実行する', () => {
    assert.equal(retention.choose(BI_PERIOD.CURRENT_STATE), BI_ENGINE.RDS);
    assert.equal(retention.choose(BI_PERIOD.ALL_PERIOD), BI_ENGINE.ATHENA);
});

test('どの決め方も、期間の指定が無い・未知の種類なら、呼び出しの誤りとして例外にする', () => {
    [retention, new FixedEnginePolicy(BI_ENGINE.RDS)].forEach((policy) => {
        [undefined, null, 'unknown', {to: TODAY}].forEach((period) => {
            assert.throws(
                () => policy.choose(period as unknown as BiPeriod),
                /period/
            );
        });
    });
});

test('保持範囲: 保持日数が正の整数でなければ例外にする', () => {
    [0, -1, 1.5].forEach((rdsRetentionDays) => {
        assert.throws(
            () =>
                new RetentionWindowPolicy({
                    rdsRetentionDays,
                    today: () => TODAY,
                }),
            /保持日数/
        );
    });
});

test('日付をずらす（月・年・うるう年をまたいでも暦どおり）', () => {
    assert.equal(shiftDays('2026-11-07', -30), '2026-10-08');
    assert.equal(shiftDays('2026-01-01', -1), '2025-12-31');
    assert.equal(shiftDays('2028-02-28', 1), '2028-02-29');
    assert.equal(shiftDays('2026-02-28', 1), '2026-03-01');
});
