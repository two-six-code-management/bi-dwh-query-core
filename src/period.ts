/**
 * 期間（from/to）を持たない問い合わせの種類。実行先の判定に使う。
 * - CURRENT_STATE: 今の状態だけを読む（顧客DBのスナップショットなど）。RDS が常に最新の全件を持つ
 * - ALL_PERIOD: 全期間の履歴を読む（最終アクセス日など）
 */
export const BI_PERIOD = Object.freeze({
    CURRENT_STATE: 'current_state',
    ALL_PERIOD: 'all_period',
} as const);

export type BiPeriodKind = (typeof BI_PERIOD)[keyof typeof BI_PERIOD];

/** 日付の範囲（YYYY-MM-DD。両端を含む） */
export interface DateRange {
    readonly from: string;
    readonly to: string;
}

/** 問い合わせが読む期間 */
export type BiPeriod = DateRange | BiPeriodKind;

const PERIOD_KINDS: ReadonlySet<unknown> = new Set(Object.values(BI_PERIOD));

/**
 * 期間を持たない問い合わせの種類かを判定する
 * @param period 期間
 */
export const isBiPeriodKind = (period: unknown): period is BiPeriodKind =>
    PERIOD_KINDS.has(period);

/**
 * 日付の範囲かを判定する（開始日だけを見る。実行先の判定に使うのが開始日のため）
 * @param period 期間
 */
export const isDateRange = (period: unknown): period is DateRange =>
    typeof (period as {from?: unknown} | null)?.from === 'string';

/**
 * 期間として正しくなければ、呼び出しの誤りとして例外にする
 * @param period 期間
 */
export const assertBiPeriod = (period: unknown): BiPeriod => {
    if (isBiPeriodKind(period) || isDateRange(period)) {
        return period;
    }
    throw new Error(
        `BI集計の実行先: period には {from, to} か BI_PERIOD の値を指定してください: ${JSON.stringify(
            period
        )}`
    );
};
