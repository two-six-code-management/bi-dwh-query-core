import type {BiEngine} from '../engineIds.js';
import {assertBiPeriod} from '../period.js';
import type {BiPeriod} from '../period.js';
import type {EngineSelectionPolicy} from './EngineSelectionPolicy.js';

/** 期間に関係なく、常に同じエンジンで実行する（設定が rds のときなど） */
export class FixedEnginePolicy implements EngineSelectionPolicy {
    private readonly engine: BiEngine;

    constructor(engine: BiEngine) {
        this.engine = engine;
    }

    choose(period: BiPeriod): BiEngine {
        assertBiPeriod(period);
        return this.engine;
    }
}
