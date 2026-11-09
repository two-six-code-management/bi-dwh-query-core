/**
 * SQLの方言。エンジンごとに書き方が違う箇所をメソッドで持つ。
 *
 * 問い合わせは RDS の書式（MySQL は `識別子`、PostgreSQL は "識別子"。パラメータは :name）で書き、
 * エンジンで書き方が違う箇所だけをこのメソッドで書く。
 * 引数・戻り値はSQLの断片（文字列）。値はパラメータ（:name）で渡し、ここへ直接埋め込まない。
 *
 * 方言はエンジンの識別子を持たない。呼び出し側がエンジンを見て書き分けられないようにするため。
 * どのエンジンでも同じ意味になる書き方を、各メソッドが受け持つ。
 */
export interface SqlDialect {
    /** 真偽値のリテラル */
    booleanLiteral(value: boolean): string;

    /** 2列の組の重複なし件数 */
    countDistinctPair(first: string, second: string): string;

    /** GROUP BY に並べる列（別名を持つ列は、エンジンが許せば別名で並べる） */
    groupByColumns(columns: readonly GroupByColumn[]): string;

    /** 条件に当てはまる行の件数（集約） */
    countIf(condition: string): string;

    /** 条件に当てはまる行があるか（集約） */
    anyTrue(condition: string): string;

    /** 値を重複なしで名前順に並べ、区切り文字で連結する（集約） */
    stringAggDistinctSorted(expression: string, separator: string): string;

    /** 日付・日時に分を足す */
    addMinutes(minutes: string, base: string): string;

    /** 日付に日数を足す */
    addDays(date: string, days: string): string;

    /** 日時から時間を引く */
    subtractHours(base: string, hours: string): string;

    /** 日数の差（後の日 − 前の日）。引数は日付で渡す（日時は asDate で日付にする） */
    dateDiffDays(later: string, earlier: string): string;

    /** 2つの日時の間の分（切り捨て） */
    minutesBetween(earlier: string, later: string): string;

    /** 2つの日時の間の秒（切り捨て） */
    secondsBetween(earlier: string, later: string): string;

    /** 取得する件数と読み飛ばす件数 */
    limitOffset(limit: string, offset: string): string;

    /** 今日（JST） */
    currentDate(): string;

    /** 小数の割り算にする値 */
    asDouble(expression: string): string;

    /** 日時を日付にする */
    asDate(expression: string): string;

    /** 文字列を整数にする（数字でない値はエラーにしない） */
    toInteger(expression: string): string;

    /** 曜日（0=月曜〜6=日曜） */
    weekday(date: string): string;

    /** その週の月曜の日付 */
    weekStart(date: string): string;

    /** 整数の割り算（切り捨て）。列と値はどちらも整数で渡す */
    integerDivide(dividend: string, divisor: string): string;
}

/** GROUP BY に並べる列。別名を省略した列は、どのエンジンでも式のまま並べる */
export interface GroupByColumn {
    readonly expression: string;
    readonly alias?: string;
}

/** SqlDialect のメソッド名（契約テストで、実装がすべて持っているかを確かめる） */
export const SQL_DIALECT_METHODS: ReadonlyArray<keyof SqlDialect> =
    Object.freeze([
        'booleanLiteral',
        'countDistinctPair',
        'groupByColumns',
        'countIf',
        'anyTrue',
        'stringAggDistinctSorted',
        'addMinutes',
        'addDays',
        'subtractHours',
        'dateDiffDays',
        'minutesBetween',
        'secondsBetween',
        'limitOffset',
        'currentDate',
        'asDouble',
        'asDate',
        'toInteger',
        'weekday',
        'weekStart',
        'integerDivide',
    ]);

/**
 * SQLの文字列リテラルにする（引用符を重ねる）
 * @param value 文字列
 */
export const quoteSqlString = (value: string): string =>
    `'${value.replace(/'/g, "''")}'`;
