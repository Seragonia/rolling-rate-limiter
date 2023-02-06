/// <reference types="node" />
export declare type Id = number | string;
export declare type Seconds = number & {
    __brand: 'seconds';
};
export declare type Milliseconds = number & {
    __brand: 'milliseconds';
};
export declare type Microseconds = number & {
    __brand: 'microseconds';
};
/**
 * Generic options for constructing any rate limiter.
 * See `README.md` for more information.
 */
export interface RateLimiterOptions {
    interval: number;
    maxInInterval: number;
    minDifference?: number;
}
/**
 * Result shape returned by `limitWithInfo` and `wouldLimitWithInfo`.
 * See `README.md` for more information.
 */
export interface RateLimitInfo {
    blocked: boolean;
    blockedDueToCount: boolean;
    blockedDueToMinDifference: boolean;
    millisecondsUntilAllowed: Milliseconds;
    actionsRemaining: number;
}
/**
 * Abstract base class for rate limiters.
 */
export declare class RateLimiter {
    interval: Microseconds;
    maxInInterval: number;
    minDifference: Microseconds;
    constructor({ interval, maxInInterval, minDifference }: RateLimiterOptions);
    /**
     * Attempts an action for the provided ID. Return information about whether the action was
     * allowed and why, and whether upcoming actions will be allowed.
     */
    limitWithInfo(id: Id): Promise<RateLimitInfo>;
    /**
     * Returns information about what would happen if an action were attempted for the provided ID.
     */
    wouldLimitWithInfo(id: Id): Promise<RateLimitInfo>;
    /**
     * Attempts an action for the provided ID. Returns whether it was blocked.
     */
    limit(id: Id): Promise<boolean>;
    /**
     * Returns whether an action for the provided ID would be blocked, if it were attempted.
     */
    wouldLimit(id: Id): Promise<boolean>;
    /**
     * Clears rate limiting state for the provided ID.
     */
    clear(_id: Id): Promise<void>;
    /**
     * Returns the list of timestamps of actions attempted within `interval` for the provided ID. If
     * `addNewTimestamp` flag is set, adds a new action with the current microsecond timestamp.
     */
    protected getTimestamps(_id: Id, _addNewTimestamp: boolean): Promise<Array<Microseconds>>;
    /**
     * Given a list of timestamps, computes the RateLimitingInfo. The last item in the list is the
     * timestamp of the current action.
     */
    private calculateInfo;
}
/**
 * Rate limiter implementation that uses an object stored in memory for storage.
 */
export declare class InMemoryRateLimiter extends RateLimiter {
    storage: Record<Id, Array<number> | undefined>;
    ttls: Record<Id, NodeJS.Timeout | undefined>;
    constructor(options: RateLimiterOptions);
    clear(id: Id): Promise<void>;
    protected getTimestamps(id: Id, addNewTimestamp: boolean): Promise<Microseconds[]>;
}
/**
 * Minimal interface of a Redis client needed for algorithm.
 * Ideally, this would be `RedisClient | IORedisClient`, but that would force consumers of this
 * library to have `@types/redis` and `@types/ioredis` to be installed.
 */
interface RedisClient {
    del(...args: Array<string>): unknown;
    multi(): RedisBatch;
}
/** Minimal interface of a Redis batch command needed for algorithm. */
interface RedisBatch {
    zremrangebyscore(key: string, min: number, max: number): void;
    zadd(key: string, score: string | number, value: string): void;
    zrange(key: string, min: number, max: number, withScores: unknown): void;
    expire(key: string, time: number): void;
    exec(cb: (err: Error | null, result: Array<unknown>) => void): void;
}
interface RedisRateLimiterOptions extends RateLimiterOptions {
    client: RedisClient;
    namespace: string;
}
/**
 * Rate limiter implementation that uses Redis for storage.
 */
export declare class RedisRateLimiter extends RateLimiter {
    client: RedisClient;
    namespace: string;
    ttl: number;
    constructor({ client, namespace, ...baseOptions }: RedisRateLimiterOptions);
    makeKey(id: Id): string;
    clear(id: Id): Promise<void>;
    protected getTimestamps(id: Id, addNewTimestamp: boolean): Promise<Array<Microseconds>>;
    private getZRangeResult;
    private extractTimestampsFromZRangeResult;
}
export declare function getCurrentMicroseconds(): Microseconds;
export declare function millisecondsToMicroseconds(milliseconds: Milliseconds): Microseconds;
export declare function microsecondsToMilliseconds(microseconds: Microseconds): Milliseconds;
export declare function microsecondsToSeconds(microseconds: Microseconds): Seconds;
export {};
