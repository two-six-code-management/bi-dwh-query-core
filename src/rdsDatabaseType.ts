/** RDS の種類。方言と、Athena へ変換するときのSQLの書式が決まる */
export const RDS_DATABASE_TYPE = Object.freeze({
    MYSQL: 'mysql',
    POSTGRES: 'postgres',
} as const);

export type RdsDatabaseType =
    (typeof RDS_DATABASE_TYPE)[keyof typeof RDS_DATABASE_TYPE];

const KNOWN_DATABASE_TYPES: ReadonlySet<string> = new Set(
    Object.values(RDS_DATABASE_TYPE)
);

/**
 * RDS の種類かを判定する
 * @param value 値
 */
export const isRdsDatabaseType = (value: unknown): value is RdsDatabaseType =>
    typeof value === 'string' && KNOWN_DATABASE_TYPES.has(value);
