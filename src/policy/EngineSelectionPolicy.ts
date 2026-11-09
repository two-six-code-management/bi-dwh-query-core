import type {BiEngine} from '../engineIds.js';
import type {BiPeriod} from '../period.js';

/** 問い合わせを実行するエンジンの決め方 */
export interface EngineSelectionPolicy {
    /**
     * 期間から実行するエンジンを決める。期間として正しくなければ例外にする
     * @param period 問い合わせが読む期間
     */
    choose(period: BiPeriod): BiEngine;
}
