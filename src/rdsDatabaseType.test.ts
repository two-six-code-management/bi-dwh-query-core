/**
 * RDS の種類のテスト。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {RDS_DATABASE_TYPE, isRdsDatabaseType} from './rdsDatabaseType.js';

test('MySQL と PostgreSQL を RDS の種類として受け付ける', () => {
    assert.deepEqual(Object.values(RDS_DATABASE_TYPE), ['mysql', 'postgres']);
    assert.equal(isRdsDatabaseType('mysql'), true);
    assert.equal(isRdsDatabaseType('postgres'), true);
});

test('それ以外は RDS の種類として受け付けない', () => {
    ['mariadb', 'oracle', '', undefined, null, 1].forEach((value) =>
        assert.equal(isRdsDatabaseType(value), false, String(value))
    );
});
