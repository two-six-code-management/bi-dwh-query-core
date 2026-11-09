import {BI_ENGINE} from '../engineIds.js';
import type {BiEngine} from '../engineIds.js';
import {BI_PERIOD, assertBiPeriod, isBiPeriodKind} from '../period.js';
import type {BiPeriod, BiPeriodKind} from '../period.js';
import type {EngineSelectionPolicy} from './EngineSelectionPolicy.js';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 日付（YYYY-MM-DD）を日数だけずらす。暦の計算は UTC で行い、タイムゾーンの影響を受けない
 * @param date 日付
 * @param days ずらす日数（負の値で前へ）
 */
export const shiftDays = (date: string, days: number): string =>
    new Date(Date.parse(`${date}T00:00:00Z`) + days * MILLISECONDS_PER_DAY)
        .toISOString()
        .slice(0, 10);

/**
 * 期間（from/to）を持たない問い合わせの実行先。
 * - 今の状態だけを読む問い合わせは RDS（RDS が常に最新の全件を持つ）
 * - 全期間を読む問い合わせは RDS の保持範囲に収まらないため Athena
 */
const ENGINE_BY_PERIOD_KIND: ReadonlyMap<BiPeriodKind, BiEngine> = new Map([
    [BI_PERIOD.CURRENT_STATE, BI_ENGINE.RDS],
    [BI_PERIOD.ALL_PERIOD, BI_ENGINE.ATHENA],
]);

export interface RetentionWindowPolicyOptions {
    /** RDS が集計データを保持している日数（正の整数） */
    readonly rdsRetentionDays: number;
    /** 今日（YYYY-MM-DD）を返す */
    readonly today: () => string;
}

/**
 * RDS の保持範囲で振り分ける。
 * 期間の開始日が保持範囲（今日から保持日数だけ遡った日以降）に収まれば、当日分も含めて
 * 全部 RDS にあるため RDS で実行する。収まらないとき・全期間を読むときだけ Athena。
 */
export class RetentionWindowPolicy implements EngineSelectionPolicy {
    private readonly rdsRetentionDays: number;

    private readonly today: () => string;

    constructor({rdsRetentionDays, today}: RetentionWindowPolicyOptions) {
        if (!Number.isInteger(rdsRetentionDays) || rdsRetentionDays <= 0) {
            throw new Error(
                `BI集計の実行先: RDS の保持日数は正の整数で指定してください: ${rdsRetentionDays}`
            );
        }
        this.rdsRetentionDays = rdsRetentionDays;
        this.today = today;
    }

    choose(period: BiPeriod): BiEngine {
        const checked = assertBiPeriod(period);
        if (isBiPeriodKind(checked)) {
            return ENGINE_BY_PERIOD_KIND.get(checked) as BiEngine;
        }
        return checked.from >= shiftDays(this.today(), -this.rdsRetentionDays)
            ? BI_ENGINE.RDS
            : BI_ENGINE.ATHENA;
    }
}
