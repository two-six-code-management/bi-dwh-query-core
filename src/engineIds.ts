/** 問い合わせを実行するエンジン */
export const BI_ENGINE = Object.freeze({
    RDS: 'rds',
    ATHENA: 'athena',
} as const);

export type BiEngine = (typeof BI_ENGINE)[keyof typeof BI_ENGINE];

const KNOWN_ENGINES: ReadonlySet<string> = new Set(Object.values(BI_ENGINE));

/**
 * エンジンの識別子かを判定する
 * @param value 値
 */
export const isBiEngine = (value: unknown): value is BiEngine =>
    typeof value === 'string' && KNOWN_ENGINES.has(value);
