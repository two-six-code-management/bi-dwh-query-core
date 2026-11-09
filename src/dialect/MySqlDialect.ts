import {quoteSqlString} from './SqlDialect.js';
import type {GroupByColumn, SqlDialect} from './SqlDialect.js';

/** RDS（MySQL 8）の書き方 */
export class MySqlDialect implements SqlDialect {
    /** 真偽値の列は tinyint(1) */
    booleanLiteral(value: boolean): string {
        return value ? '1' : '0';
    }

    countDistinctPair(first: string, second: string): string {
        return `COUNT(DISTINCT ${first}, ${second})`;
    }

    /** SELECT の別名を GROUP BY に使える */
    groupByColumns(columns: readonly GroupByColumn[]): string {
        return columns
            .map(({expression, alias}) => (alias ? `\`${alias}\`` : expression))
            .join(', ');
    }

    /** 真偽式は 0/1 のため SUM で数えられる */
    countIf(condition: string): string {
        return `SUM(${condition})`;
    }

    anyTrue(condition: string): string {
        return `MAX(${condition})`;
    }

    stringAggDistinctSorted(expression: string, separator: string): string {
        return `GROUP_CONCAT(DISTINCT ${expression} ORDER BY ${expression} SEPARATOR ${quoteSqlString(
            separator
        )})`;
    }

    addMinutes(minutes: string, base: string): string {
        return `TIMESTAMPADD(MINUTE, ${minutes}, ${base})`;
    }

    addDays(date: string, days: string): string {
        return `DATE_ADD(${date}, INTERVAL ${days} DAY)`;
    }

    subtractHours(base: string, hours: string): string {
        return `${base} - INTERVAL ${hours} HOUR`;
    }

    dateDiffDays(later: string, earlier: string): string {
        return `DATEDIFF(${later}, ${earlier})`;
    }

    minutesBetween(earlier: string, later: string): string {
        return `TIMESTAMPDIFF(MINUTE, ${earlier}, ${later})`;
    }

    secondsBetween(earlier: string, later: string): string {
        return `TIMESTAMPDIFF(SECOND, ${earlier}, ${later})`;
    }

    limitOffset(limit: string, offset: string): string {
        return `LIMIT ${limit} OFFSET ${offset}`;
    }

    /** 接続のタイムゾーンが JST（+09:00）のため CURDATE() でよい */
    currentDate(): string {
        return 'CURDATE()';
    }

    /** MySQL の / は整数同士でも小数になるため、そのまま */
    asDouble(expression: string): string {
        return expression;
    }

    /** DATEDIFF は時刻を見ないため、そのまま */
    asDate(expression: string): string {
        return expression;
    }

    toInteger(expression: string): string {
        return `CAST(${expression} AS UNSIGNED)`;
    }

    /** WEEKDAY は 0=月曜 */
    weekday(date: string): string {
        return `WEEKDAY(${date})`;
    }

    /** WEEKDAY は 0=月曜のため、その日数だけ戻す */
    weekStart(date: string): string {
        return `DATE_SUB(${date}, INTERVAL WEEKDAY(${date}) DAY)`;
    }

    integerDivide(dividend: string, divisor: string): string {
        return `(${dividend} DIV ${divisor})`;
    }
}
