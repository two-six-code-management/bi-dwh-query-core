/**
 * SQLへ渡す型付きの値（日付・日時）のテスト。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    biSqlDate,
    biSqlTimestamp,
    isBiSqlValue,
    toPlainParams,
} from './values.js';

test('日付・日時を型付きの値として作る', () => {
    assert.equal(isBiSqlValue(biSqlDate('2026-11-07')), true);
    assert.equal(isBiSqlValue(biSqlTimestamp('2026-11-07 09:30:00')), true);
    assert.equal(
        isBiSqlValue(biSqlTimestamp('2026-11-07 09:30:00.123456')),
        true
    );
    assert.equal(isBiSqlValue('2026-11-07'), false);
    assert.equal(isBiSqlValue(null), false);
});

test('形式が違う日付・日時は、SQLへ埋め込む前に例外にする', () => {
    ["2026-11-07' OR '1'='1", '2026/11/07', '', undefined].forEach((value) => {
        assert.throws(
            () => biSqlDate(value as unknown as string),
            /日付/,
            String(value)
        );
    });
    ['2026-11-07', '2026-11-07T09:30:00', '2026-11-07 9:30:00'].forEach(
        (value) => {
            assert.throws(() => biSqlTimestamp(value), /日時/, value);
        }
    );
});

test('パッケージを別々に読み込んでも、型付きの値と判定できる（目印はグローバルなシンボル）', () => {
    const copied = {...biSqlDate('2026-11-07')};

    assert.equal(isBiSqlValue(copied), true);
});

test('RDSへ渡すときは、型付きの値を素の文字列へ戻す（配列の中も）', () => {
    assert.deepEqual(
        toPlainParams({
            from: biSqlDate('2026-10-01'),
            until: biSqlTimestamp('2026-11-01 00:00:00'),
            dates: [biSqlDate('2026-10-01'), biSqlDate('2026-10-02')],
            systems: ['alpha', 'beta'],
            limit: 30,
            flag: null,
        }),
        {
            from: '2026-10-01',
            until: '2026-11-01 00:00:00',
            dates: ['2026-10-01', '2026-10-02'],
            systems: ['alpha', 'beta'],
            limit: 30,
            flag: null,
        }
    );
});
