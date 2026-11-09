/**
 * SQLへ渡す値。
 *
 * Athena（Trino）は日付・日時の列と文字列を比べると型エラーになるため、
 * 日付・日時は型付きの値（biSqlDate / biSqlTimestamp）で渡す。
 * Athena では DATE / TIMESTAMP のリテラルにし、RDS へは素の文字列に戻して渡す。
 */

/** 型付きの値の種類 */
export const BI_SQL_VALUE_TYPE = Object.freeze({
    DATE: 'date',
    TIMESTAMP: 'timestamp',
} as const);

export type BiSqlValueType =
    (typeof BI_SQL_VALUE_TYPE)[keyof typeof BI_SQL_VALUE_TYPE];

/**
 * 型付きの値であることの目印。
 * 同じパッケージが別々に読み込まれても判定できるよう、グローバルなシンボルにする。
 */
const BI_SQL_VALUE_MARK: unique symbol = Symbol.for(
    'bi-dwh-query.biSqlValue'
) as never;

/** 型付きの値（日付・日時） */
export interface BiSqlValue {
    readonly [BI_SQL_VALUE_MARK]: true;
    readonly sqlType: BiSqlValueType;
    readonly value: string;
}

/** SQLへ渡せる値。配列は IN (:name) の展開に使う */
export type BiParamValue =
    | string
    | number
    | boolean
    | null
    | BiSqlValue
    | readonly BiParamValue[];

/** 名前付きパラメータ（:name）の値 */
export type BiParams = Readonly<Record<string, BiParamValue>>;

/** RDS の実行役へ渡す値（型付きの値を素の文字列へ戻したもの） */
export type RdsParamValue =
    | string
    | number
    | boolean
    | null
    | readonly RdsParamValue[];

export type RdsParams = Readonly<Record<string, RdsParamValue>>;

/** 種類ごとの形式。SQLへ埋め込む前に検証する */
const VALUE_PATTERN: ReadonlyMap<BiSqlValueType, RegExp> = new Map([
    [BI_SQL_VALUE_TYPE.DATE, /^\d{4}-\d{2}-\d{2}$/],
    [
        BI_SQL_VALUE_TYPE.TIMESTAMP,
        /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?$/,
    ],
]);

/** エラーに出す種類の名前 */
const VALUE_LABEL: ReadonlyMap<BiSqlValueType, string> = new Map([
    [BI_SQL_VALUE_TYPE.DATE, '日付（YYYY-MM-DD）'],
    [BI_SQL_VALUE_TYPE.TIMESTAMP, '日時（YYYY-MM-DD HH:mm:ss）'],
]);

const createValue = (sqlType: BiSqlValueType, value: string): BiSqlValue => {
    if (typeof value !== 'string' || !VALUE_PATTERN.get(sqlType)?.test(value)) {
        throw new Error(
            `BI集計SQLの値: ${VALUE_LABEL.get(
                sqlType
            )}の形式ではありません: ${JSON.stringify(value)}`
        );
    }
    return Object.freeze({[BI_SQL_VALUE_MARK]: true as const, sqlType, value});
};

/**
 * 日付（YYYY-MM-DD）の値を作る
 * @param value 日付
 */
export const biSqlDate = (value: string): BiSqlValue =>
    createValue(BI_SQL_VALUE_TYPE.DATE, value);

/**
 * 日時（YYYY-MM-DD HH:mm:ss）の値を作る
 * @param value 日時
 */
export const biSqlTimestamp = (value: string): BiSqlValue =>
    createValue(BI_SQL_VALUE_TYPE.TIMESTAMP, value);

/**
 * 型付きの値かを判定する
 * @param value 値
 */
export const isBiSqlValue = (value: unknown): value is BiSqlValue =>
    Boolean((value as Partial<BiSqlValue> | null)?.[BI_SQL_VALUE_MARK]);

const toPlainValue = (value: BiParamValue): RdsParamValue => {
    if (Array.isArray(value)) {
        return value.map(toPlainValue);
    }
    return isBiSqlValue(value) ? value.value : (value as RdsParamValue);
};

/**
 * RDS へ渡す値にする。型付きの値は素の文字列へ戻す（配列の中も）
 * @param params 値
 */
export const toPlainParams = (params: BiParams): RdsParams =>
    Object.fromEntries(
        Object.entries(params).map(([key, value]) => [key, toPlainValue(value)])
    );
