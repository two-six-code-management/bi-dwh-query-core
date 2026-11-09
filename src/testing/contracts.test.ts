/**
 * 契約テストを、核の実装に当てはめる。
 * 他のシステムが RDS の実行役や決め方を書いたときも、同じ契約テストを流して確かめる。
 */
import {mockClient} from 'aws-sdk-client-mock';
import {
    AthenaClient,
    GetQueryExecutionCommand,
    GetQueryResultsCommand,
    StartQueryExecutionCommand,
} from '@aws-sdk/client-athena';

import {ATHENA_QUERY_STATE} from '../constants.js';
import {BI_ENGINE} from '../engineIds.js';
import {AthenaQueryEngine} from '../engine/AthenaQueryEngine.js';
import {RdsQueryEngine} from '../engine/RdsQueryEngine.js';
import {RDS_DATABASE_TYPE} from '../rdsDatabaseType.js';
import {FixedEnginePolicy} from '../policy/FixedEnginePolicy.js';
import {RetentionWindowPolicy} from '../policy/RetentionWindowPolicy.js';
import {
    defineBiQueryEngineContract,
    defineEngineSelectionPolicyContract,
} from './contracts.js';
import type {ContractRow} from './contracts.js';

defineBiQueryEngineContract('RdsQueryEngine', {
    createReturning: (rows) =>
        new RdsQueryEngine({
            runner: {
                databaseType: RDS_DATABASE_TYPE.MYSQL,
                select: async <Row>() => rows as unknown as Row[],
            },
        }),
    createFailing: (error) =>
        new RdsQueryEngine({
            runner: {
                databaseType: RDS_DATABASE_TYPE.MYSQL,
                select: async () => {
                    throw error;
                },
            },
        }),
});

const athenaMock = mockClient(AthenaClient);

/** 行を Athena の結果の形にして返すよう、クライアントを差し替える */
const mockAthenaRows = (rows: readonly ContractRow[]) => {
    athenaMock.reset();
    athenaMock.on(StartQueryExecutionCommand).resolves({QueryExecutionId: 'q'});
    athenaMock.on(GetQueryExecutionCommand).resolves({
        QueryExecution: {Status: {State: ATHENA_QUERY_STATE.SUCCEEDED}},
    });
    athenaMock.on(GetQueryResultsCommand).resolves({
        ResultSet: {
            ResultSetMetadata: {
                ColumnInfo: [
                    {Label: 'name', Name: 'name', Type: 'varchar'},
                    {Label: 'users', Name: 'users', Type: 'bigint'},
                ],
            },
            Rows: [
                {Data: [{VarCharValue: 'name'}, {VarCharValue: 'users'}]},
                ...rows.map(({name, users}) => ({
                    Data: [{VarCharValue: name}, {VarCharValue: String(users)}],
                })),
            ],
        },
    });
};

const createAthenaEngine = () =>
    new AthenaQueryEngine({
        client: new AthenaClient({region: 'ap-northeast-1'}),
        workGroup: 'bi-workgroup',
        database: 'bi_curated_example',
        pollIntervalMs: 0,
    });

defineBiQueryEngineContract('AthenaQueryEngine', {
    createReturning: (rows) => {
        mockAthenaRows(rows);
        return createAthenaEngine();
    },
    createFailing: (error) => {
        athenaMock.reset();
        athenaMock.on(StartQueryExecutionCommand).rejects(error);
        return createAthenaEngine();
    },
});

defineEngineSelectionPolicyContract(
    'FixedEnginePolicy',
    () => new FixedEnginePolicy(BI_ENGINE.RDS)
);
defineEngineSelectionPolicyContract(
    'RetentionWindowPolicy',
    () =>
        new RetentionWindowPolicy({
            rdsRetentionDays: 30,
            today: () => '2026-11-07',
        })
);
