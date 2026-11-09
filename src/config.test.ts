/**
 * 設定（環境変数の読み取りと検証）のテスト。環境変数の名前は使う側が決めて渡す。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    BI_DEFAULT_ATHENA_CATALOG,
    BI_DEFAULT_RDS_RETENTION_DAYS,
} from './constants.js';
import {BI_ENGINE} from './engineIds.js';
import {readBiQueryConfig} from './config.js';
import type {BiQueryConfigNames} from './config.js';

const NAMES: BiQueryConfigNames = Object.freeze({
    engine: 'BI_QUERY_ENGINE',
    athenaWorkGroup: 'BI_ATHENA_WORKGROUP',
    athenaDatabase: 'BI_ATHENA_DATABASE',
    athenaCatalog: 'BI_ATHENA_CATALOG',
    rdsRetentionDays: 'BI_RDS_RETENTION_DAYS',
});

const ATHENA_ENV = Object.freeze({
    BI_QUERY_ENGINE: 'athena',
    BI_ATHENA_WORKGROUP: 'bi-workgroup',
    BI_ATHENA_DATABASE: 'bi_curated_example',
});

const read = (env: Record<string, string | undefined>) =>
    readBiQueryConfig(env, NAMES);

test('環境変数が未設定なら、RDSで実行し、保持日数とカタログは既定値になる', () => {
    assert.deepEqual(read({}), {
        engine: BI_ENGINE.RDS,
        rdsRetentionDays: BI_DEFAULT_RDS_RETENTION_DAYS,
        athena: {
            workGroup: null,
            database: null,
            catalog: BI_DEFAULT_ATHENA_CATALOG,
        },
    });
});

test('キーだけ定義されて値が空・空白のときは未設定として扱う', () => {
    const config = read({
        BI_QUERY_ENGINE: ' ',
        BI_RDS_RETENTION_DAYS: '',
        BI_ATHENA_CATALOG: '',
    });

    assert.equal(config.engine, BI_ENGINE.RDS);
    assert.equal(config.rdsRetentionDays, BI_DEFAULT_RDS_RETENTION_DAYS);
    assert.equal(config.athena.catalog, BI_DEFAULT_ATHENA_CATALOG);
});

test('athenaを指定すると、ワークグループ・データベース・カタログ・保持日数を読む（前後の空白は除く）', () => {
    const config = read({
        ...ATHENA_ENV,
        BI_QUERY_ENGINE: ' athena ',
        BI_ATHENA_CATALOG: 'OtherCatalog',
        BI_RDS_RETENTION_DAYS: '45',
    });

    assert.deepEqual(config, {
        engine: BI_ENGINE.ATHENA,
        rdsRetentionDays: 45,
        athena: {
            workGroup: 'bi-workgroup',
            database: 'bi_curated_example',
            catalog: 'OtherCatalog',
        },
    });
});

test('未知のエンジンは、RDSへ黙って戻さず例外にする（エラーには環境変数の名前を出す）', () => {
    assert.throws(() => read({BI_QUERY_ENGINE: 'redshift'}), /BI_QUERY_ENGINE/);
});

test('athenaでワークグループかデータベースが無ければ例外にする', () => {
    assert.throws(
        () => read({...ATHENA_ENV, BI_ATHENA_WORKGROUP: ''}),
        /BI_ATHENA_WORKGROUP/
    );
    assert.throws(
        () => read({...ATHENA_ENV, BI_ATHENA_DATABASE: undefined}),
        /BI_ATHENA_DATABASE/
    );
});

test('保持日数が正の整数でなければ例外にする', () => {
    ['0', '-1', '1.5', 'abc'].forEach((value) => {
        assert.throws(
            () => read({BI_RDS_RETENTION_DAYS: value}),
            /BI_RDS_RETENTION_DAYS/,
            value
        );
    });
});

test('環境変数の名前は使う側が決められる', () => {
    const config = readBiQueryConfig(
        {
            OTHER_BI_ENGINE: 'athena',
            OTHER_BI_WORKGROUP: 'wg',
            OTHER_BI_DATABASE: 'bi_curated_other',
        },
        {
            engine: 'OTHER_BI_ENGINE',
            athenaWorkGroup: 'OTHER_BI_WORKGROUP',
            athenaDatabase: 'OTHER_BI_DATABASE',
            athenaCatalog: 'OTHER_BI_CATALOG',
            rdsRetentionDays: 'OTHER_BI_RETENTION_DAYS',
        }
    );

    assert.equal(config.engine, BI_ENGINE.ATHENA);
    assert.equal(config.athena.database, 'bi_curated_other');
});
