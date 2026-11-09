import {BI_DEFAULT_TIME_ZONE} from '../constants.js';
import {quoteSqlString} from './SqlDialect.js';
import type {GroupByColumn, SqlDialect} from './SqlDialect.js';

/** 文字列が整数だけでできているか（前後の空白を除いて） */
const INTEGER_TEXT_PATTERN = quoteSqlString('^[+-]?[0-9]+$');

/** RDS（PostgreSQL）の書き方。どのメソッドも MySQL の方言と同じ結果になるようにする */
export class PostgresDialect implements SqlDialect {
    booleanLiteral(value: boolean): string {
        return value ? 'TRUE' : 'FALSE';
    }

    /** COUNT(DISTINCT a, b) は使えないため、ROW で組にして数える */
    countDistinctPair(first: string, second: string): string {
        return `COUNT(DISTINCT ROW(${first}, ${second}))`;
    }

    /** 別名も使えるが、入力の列と同じ名前の別名は入力の列が優先されるため、式を並べる */
    groupByColumns(columns: readonly GroupByColumn[]): string {
        return columns.map(({expression}) => expression).join(', ');
    }

    /** 真偽値は SUM できないため FILTER で数える */
    countIf(condition: string): string {
        return `COUNT(*) FILTER (WHERE ${condition})`;
    }

    anyTrue(condition: string): string {
        return `BOOL_OR(${condition})`;
    }

    /** STRING_AGG は文字列しか受け付けないため、文字列にしてから並べて連結する */
    stringAggDistinctSorted(expression: string, separator: string): string {
        const text = `CAST(${expression} AS text)`;
        return `STRING_AGG(DISTINCT ${text}, ${quoteSqlString(
            separator
        )} ORDER BY ${text})`;
    }

    /** INTERVAL にパラメータを書けないため、1分の INTERVAL に掛ける。日付は timestamp にしてから足す */
    addMinutes(minutes: string, base: string): string {
        return `(CAST(${base} AS timestamp) + (${minutes}) * INTERVAL '1 minute')`;
    }

    /** 日付＋整数は日付になる */
    addDays(date: string, days: string): string {
        return `(CAST(${date} AS date) + CAST(${days} AS integer))`;
    }

    subtractHours(base: string, hours: string): string {
        return `(${base} - (${hours}) * INTERVAL '1 hour')`;
    }

    /** 日付−日付は日数になる */
    dateDiffDays(later: string, earlier: string): string {
        return `(CAST(${later} AS date) - CAST(${earlier} AS date))`;
    }

    /** TIMESTAMPDIFF は無いため、経過秒から求めて0へ向けて切り捨てる */
    minutesBetween(earlier: string, later: string): string {
        return `CAST(TRUNC(${this.elapsedSeconds(
            earlier,
            later
        )} / 60) AS bigint)`;
    }

    secondsBetween(earlier: string, later: string): string {
        return `CAST(TRUNC(${this.elapsedSeconds(earlier, later)}) AS bigint)`;
    }

    limitOffset(limit: string, offset: string): string {
        return `LIMIT ${limit} OFFSET ${offset}`;
    }

    /** セッションのタイムゾーンに依らないよう、JST へ直してから日付にする */
    currentDate(): string {
        return `CAST(CURRENT_TIMESTAMP AT TIME ZONE '${BI_DEFAULT_TIME_ZONE}' AS date)`;
    }

    /** 整数同士の / は整数の割り算になるため、double precision にする */
    asDouble(expression: string): string {
        return `CAST(${expression} AS double precision)`;
    }

    asDate(expression: string): string {
        return `CAST(${expression} AS date)`;
    }

    /** CAST は数字でない値でエラーになり、TRY_CAST も無いため、数字だけのときだけ整数にする */
    toInteger(expression: string): string {
        const text = `TRIM(CAST(${expression} AS text))`;
        return `CASE WHEN ${text} ~ ${INTEGER_TEXT_PATTERN} THEN CAST(${text} AS bigint) END`;
    }

    /** ISODOW は 1=月曜〜7=日曜のため1を引く */
    weekday(date: string): string {
        return `(CAST(EXTRACT(ISODOW FROM ${date}) AS integer) - 1)`;
    }

    /** date_trunc の週は月曜始まりで、timestamp が返るため日付にする */
    weekStart(date: string): string {
        return `CAST(date_trunc('week', ${date}) AS date)`;
    }

    /** 整数同士の / は0へ向けて切り捨てる（MySQL の DIV と同じ） */
    integerDivide(dividend: string, divisor: string): string {
        return `(${dividend} / ${divisor})`;
    }

    /** 2つの日時の間の経過秒（小数を含む） */
    private elapsedSeconds(earlier: string, later: string): string {
        return `EXTRACT(EPOCH FROM (CAST(${later} AS timestamp) - CAST(${earlier} AS timestamp)))`;
    }
}
