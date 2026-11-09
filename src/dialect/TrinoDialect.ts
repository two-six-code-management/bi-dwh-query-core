import {BI_DEFAULT_TIME_ZONE} from '../constants.js';
import {quoteSqlString} from './SqlDialect.js';
import type {GroupByColumn, SqlDialect} from './SqlDialect.js';

/** Athena（engine v3。Trino）の書き方 */
export class TrinoDialect implements SqlDialect {
    /** 真偽値の列は Iceberg で boolean */
    booleanLiteral(value: boolean): string {
        return value ? 'TRUE' : 'FALSE';
    }

    /** COUNT(DISTINCT a, b) は使えないため、ROW で組にして数える */
    countDistinctPair(first: string, second: string): string {
        return `COUNT(DISTINCT ROW(${first}, ${second}))`;
    }

    /** SELECT の別名を GROUP BY に使えないため、式を並べる */
    groupByColumns(columns: readonly GroupByColumn[]): string {
        return columns.map(({expression}) => expression).join(', ');
    }

    /** 真偽値は SUM できないため COUNT_IF で数える */
    countIf(condition: string): string {
        return `COUNT_IF(${condition})`;
    }

    anyTrue(condition: string): string {
        return `bool_or(${condition})`;
    }

    /** GROUP_CONCAT は無いため、配列に集めて並べてから連結する */
    stringAggDistinctSorted(expression: string, separator: string): string {
        return `array_join(array_sort(array_agg(DISTINCT ${expression})), ${quoteSqlString(
            separator
        )})`;
    }

    /** 日付に分は足せないため、timestamp にしてから足す */
    addMinutes(minutes: string, base: string): string {
        return `date_add('minute', ${minutes}, CAST(${base} AS timestamp))`;
    }

    /** INTERVAL にパラメータを書けないため date_add で足す */
    addDays(date: string, days: string): string {
        return `date_add('day', ${days}, ${date})`;
    }

    /** INTERVAL にパラメータを書けないため date_add で引く */
    subtractHours(base: string, hours: string): string {
        return `date_add('hour', -(${hours}), ${base})`;
    }

    /**
     * date_diff は引数の順が DATEDIFF と逆（前の日, 後の日）。
     * 日時を渡すと時刻まで見て数え、DATEDIFF と結果が変わるため、日時は asDate で日付にしてから渡す
     */
    dateDiffDays(later: string, earlier: string): string {
        return `date_diff('day', ${earlier}, ${later})`;
    }

    /** TIMESTAMPDIFF は無い。date_diff も端数を切り捨てる */
    minutesBetween(earlier: string, later: string): string {
        return `date_diff('minute', ${earlier}, ${later})`;
    }

    secondsBetween(earlier: string, later: string): string {
        return `date_diff('second', ${earlier}, ${later})`;
    }

    /** OFFSET を LIMIT より前に書く */
    limitOffset(limit: string, offset: string): string {
        return `OFFSET ${offset} LIMIT ${limit}`;
    }

    /** セッションのタイムゾーンは UTC のため、JST へ直してから日付にする */
    currentDate(): string {
        return `CAST(current_timestamp AT TIME ZONE '${BI_DEFAULT_TIME_ZONE}' AS date)`;
    }

    /** 整数同士の / は整数の割り算になるため、double にする */
    asDouble(expression: string): string {
        return `CAST(${expression} AS double)`;
    }

    asDate(expression: string): string {
        return `CAST(${expression} AS date)`;
    }

    /** CAST は数字でない値でエラーになる。MySQL はエラーにしないため、TRY_CAST で NULL にする */
    toInteger(expression: string): string {
        return `TRY_CAST(${expression} AS bigint)`;
    }

    /** day_of_week は 1=月曜〜7=日曜のため1を引く */
    weekday(date: string): string {
        return `(day_of_week(${date}) - 1)`;
    }

    /** date_trunc の週は月曜始まりで、日付を渡すと日付が返る */
    weekStart(date: string): string {
        return `date_trunc('week', ${date})`;
    }

    /** DIV は無い。整数同士の / は切り捨てになる */
    integerDivide(dividend: string, divisor: string): string {
        return `(${dividend} / ${divisor})`;
    }
}
