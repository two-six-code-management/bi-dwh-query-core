/**
 * RDS の書式（MySQL / PostgreSQL）で書いたSQLを、Athena（Trino）で実行できる形へ変換する。
 *
 * どのSQLにも共通する差だけを機械的に変換する（パラメータ・識別子の囲み・スキーマの修飾）。
 * 関数・GROUP BY など、SQLごとの差は方言（SqlDialect）で書き分ける。
 *
 * 値は Athena の ExecutionParameters で渡さず、エスケープしたリテラルとして埋め込む。
 * Sequelize の replacements と同じ方式で、IN の要素数の多い配列でも件数の制約を受けない。
 */
import {BI_ATHENA_MAX_QUERY_BYTES} from '../constants.js';
import {quoteSqlString} from '../dialect/SqlDialect.js';
import {RDS_DATABASE_TYPE} from '../rdsDatabaseType.js';
import type {RdsDatabaseType} from '../rdsDatabaseType.js';
import {BI_SQL_VALUE_TYPE, isBiSqlValue} from '../values.js';
import type {BiParamValue, BiParams, BiSqlValueType} from '../values.js';

const NULL_LITERAL = 'NULL';

/** 型付きの値のリテラルの接頭辞 */
const TYPED_LITERAL_PREFIX: ReadonlyMap<BiSqlValueType, string> = new Map([
    [BI_SQL_VALUE_TYPE.DATE, 'DATE'],
    [BI_SQL_VALUE_TYPE.TIMESTAMP, 'TIMESTAMP'],
]);

type LiteralRule = readonly [
    matches: (value: unknown) => boolean,
    toLiteral: (value: never) => string
];

/** 値の種類ごとのリテラルの作り方。上から順に、最初に当てはまったもので作る */
const LITERAL_RULES: readonly LiteralRule[] = [
    [(value) => value === null, () => NULL_LITERAL],
    [
        Array.isArray,
        (values: readonly BiParamValue[]) =>
            values.length === 0
                ? NULL_LITERAL
                : values.map(toElementLiteral).join(', '),
    ],
    [
        isBiSqlValue,
        (value: {sqlType: BiSqlValueType; value: string}) =>
            `${TYPED_LITERAL_PREFIX.get(value.sqlType)} ${quoteSqlString(
                value.value
            )}`,
    ],
    // Trino の文字列リテラルにバックスラッシュのエスケープは無く、引用符を重ねるだけでよい
    [(value) => typeof value === 'string', quoteSqlString],
    [(value) => Number.isFinite(value), (value: number) => String(value)],
    [
        (value) => typeof value === 'boolean',
        (value: boolean) => (value ? 'TRUE' : 'FALSE'),
    ],
];

/**
 * 値を Athena のリテラルにする。
 * 配列は要素をカンマ区切りにし（IN (:array) 用）、空配列は NULL にする（Sequelize と同じ）。
 * 日付・日時は biSqlDate / biSqlTimestamp で渡す（Date はタイムゾーンが曖昧なため受け付けない）。
 * @param value 値
 */
export const toAthenaLiteral = (value: BiParamValue): string => {
    const rule = LITERAL_RULES.find(([matches]) => matches(value));
    if (!rule) {
        throw new Error(
            `Athena用SQLの変換: リテラルにできない値です: ${String(value)}`
        );
    }
    return rule[1](value as never);
};

/** 配列の要素をリテラルにする。要素が配列なら組（タプル）にする（Sequelize と同じ） */
const toElementLiteral = (value: BiParamValue): string =>
    Array.isArray(value)
        ? `(${value.map(toAthenaLiteral).join(', ')})`
        : toAthenaLiteral(value);

/** 囲まずに書いた、スキーマの候補（後ろに . が続く名前。前が名前・. ・引用符なら別の名前の一部） */
const BARE_QUALIFIER =
    String.raw`(?<![\w$."` + '`' + String.raw`])(?<bare>[A-Za-z_][\w$]*)(?=\.)`;

/**
 * 書式ごとの、変換の対象になる字句。文字列リテラル・コメントはそのまま残すために拾う。
 * - string: '...'（'' のエスケープ。MySQL は \' のエスケープも含む）
 * - comment: /* ... *\/ と -- ...
 * - identifier: MySQL は `...`（`` のエスケープ）、PostgreSQL は "..."（"" のエスケープ）
 * - cast: ::（PostgreSQL のキャスト。パラメータと誤認しない）
 * - param: :name
 * - bare: 囲まずに書いたスキーマの候補
 */
const TOKEN_PATTERNS: ReadonlyMap<RdsDatabaseType, RegExp> = new Map([
    [
        RDS_DATABASE_TYPE.MYSQL,
        new RegExp(
            String.raw`(?<string>'(?:[^'\\]|''|\\.)*')|(?<comment>\/\*[\s\S]*?\*\/|--[^\n]*)|(?<identifier>` +
                '`(?:[^`]|``)*`' +
                String.raw`)|(?<cast>::)|:(?<param>[A-Za-z_]\w*)|${BARE_QUALIFIER}`,
            'g'
        ),
    ],
    [
        RDS_DATABASE_TYPE.POSTGRES,
        new RegExp(
            String.raw`(?<string>'(?:[^']|'')*')|(?<comment>\/\*[\s\S]*?\*\/|--[^\n]*)|(?<identifier>"(?:[^"]|"")*")|(?<cast>::)|:(?<param>[A-Za-z_]\w*)|${BARE_QUALIFIER}`,
            'g'
        ),
    ],
]);

/** 識別子の囲みを外して名前にする */
const IDENTIFIER_UNQUOTERS: ReadonlyMap<
    RdsDatabaseType,
    (token: string) => string
> = new Map([
    [
        RDS_DATABASE_TYPE.MYSQL,
        (token: string) => token.slice(1, -1).replace(/``/g, '`'),
    ],
    [
        RDS_DATABASE_TYPE.POSTGRES,
        (token: string) => token.slice(1, -1).replace(/""/g, '"'),
    ],
]);

export interface AthenaSqlOptions {
    /**
     * 読み替えるスキーマ（RDS のスキーマ名 → Athena のデータベース）。
     * スキーマ.テーブル の修飾にだけ使い、それ以外の識別子は読み替えない。
     * 囲まずに書いた修飾（aggregation.t）も読み替えるため、スキーマ名と同じ別名を付けない
     */
    readonly schemaAliases?: Readonly<Record<string, string>>;
    /** 変換するSQLの書式（RDS の種類）。省略すると MySQL */
    readonly sourceSyntax?: RdsDatabaseType;
}

/** Athena の識別子にする */
const quoteAthenaIdentifier = (name: string): string =>
    `"${name.replace(/"/g, '""')}"`;

/** 読み替えるスキーマなら、Athena のデータベースを返す */
const resolveSchema = (
    name: string,
    schemaAliases: Readonly<Record<string, string>>
): string | undefined =>
    Object.prototype.hasOwnProperty.call(schemaAliases, name)
        ? schemaAliases[name]
        : undefined;

/** パラメータを値のリテラルへ置き換える */
const convertParam = (name: string, params: BiParams): string => {
    const value = params[name];
    if (value === undefined) {
        throw new Error(
            `Athena用SQLの変換: パラメータ :${name} の値がありません`
        );
    }
    return toAthenaLiteral(value);
};

/** 字句の種類 */
type TokenGroups = Readonly<Record<string, string | undefined>>;

interface TokenContext {
    readonly token: string;
    readonly groups: TokenGroups;
    /** 後ろに . が続く（スキーマ・テーブルの修飾） */
    readonly qualifies: boolean;
    readonly params: BiParams;
    readonly schemaAliases: Readonly<Record<string, string>>;
    readonly sourceSyntax: RdsDatabaseType;
}

type TokenConverter = (context: TokenContext) => string;

/** 囲んだ識別子: ダブルクォートにする。テーブルの修飾に使ったスキーマは読み替える */
const convertIdentifier: TokenConverter = ({
    token,
    qualifies,
    schemaAliases,
    sourceSyntax,
}) => {
    const name = (
        IDENTIFIER_UNQUOTERS.get(sourceSyntax) as (token: string) => string
    )(token);
    const schema = qualifies ? resolveSchema(name, schemaAliases) : undefined;
    return quoteAthenaIdentifier(schema ?? name);
};

/** 囲まないスキーマの候補: 読み替えるスキーマならデータベースにする */
const convertBareQualifier: TokenConverter = ({token, schemaAliases}) => {
    const schema = resolveSchema(token, schemaAliases);
    return schema === undefined ? token : quoteAthenaIdentifier(schema);
};

/** キャスト: Athena は :: を使えないため、PostgreSQL の書式では例外にする */
const convertCast: TokenConverter = ({token, sourceSyntax}) => {
    if (sourceSyntax === RDS_DATABASE_TYPE.POSTGRES) {
        throw new Error(
            'Athena用SQLの変換: Athena は :: のキャストを使えません。CAST(… AS …) で書いてください'
        );
    }
    return token;
};

/** 字句の種類ごとの変換。文字列リテラル・コメントはそのまま残す */
const TOKEN_CONVERTERS: ReadonlyArray<readonly [string, TokenConverter]> = [
    ['identifier', convertIdentifier],
    ['bare', convertBareQualifier],
    ['cast', convertCast],
    [
        'param',
        ({groups, params}) => convertParam(groups.param as string, params),
    ],
];

/**
 * RDS の書式のSQLを、Athena で実行できる形へ変換する。文字列リテラル・コメントの中は変換しない
 * @param sql RDS の書式のSQL（:name のパラメータ、MySQL は `識別子`、PostgreSQL は "識別子"）
 * @param params パラメータの値
 * @param options スキーマの読み替えと、SQLの書式
 */
export const convertToAthenaSql = (
    sql: string,
    params: BiParams,
    {
        schemaAliases = {},
        sourceSyntax = RDS_DATABASE_TYPE.MYSQL,
    }: AthenaSqlOptions = {}
): string => {
    const pattern = TOKEN_PATTERNS.get(sourceSyntax);
    if (!pattern) {
        throw new Error(
            `Athena用SQLの変換: 対応していないSQLの書式です: ${String(
                sourceSyntax
            )}`
        );
    }

    const converted = sql.replace(pattern, (token, ...args) => {
        const groups = args[args.length - 1] as TokenGroups;
        const offset = args[args.length - 3] as number;
        const entry = TOKEN_CONVERTERS.find(
            ([name]) => groups[name] !== undefined
        );
        return entry
            ? entry[1]({
                  token,
                  groups,
                  qualifies: sql[offset + token.length] === '.',
                  params,
                  schemaAliases,
                  sourceSyntax,
              })
            : token;
    });

    if (Buffer.byteLength(converted, 'utf8') > BI_ATHENA_MAX_QUERY_BYTES) {
        throw new Error(
            `Athena用SQLの変換: SQLが上限（${BI_ATHENA_MAX_QUERY_BYTES}バイト）を超えています`
        );
    }
    return converted;
};
