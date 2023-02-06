"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.microsecondsToSeconds = exports.microsecondsToMilliseconds = exports.millisecondsToMicroseconds = exports.getCurrentMicroseconds = exports.RedisRateLimiter = exports.InMemoryRateLimiter = exports.RateLimiter = void 0;
const assert_1 = __importDefault(require("assert"));
const microtime_1 = __importDefault(require("microtime"));
const uuid_1 = require("uuid");
/**
 * Abstract base class for rate limiters.
 */
class RateLimiter {
    constructor({ interval, maxInInterval, minDifference = 0 }) {
        (0, assert_1.default)(interval > 0, 'Must pass a positive integer for `options.interval`');
        (0, assert_1.default)(maxInInterval > 0, 'Must pass a positive integer for `options.maxInInterval`');
        (0, assert_1.default)(minDifference >= 0, '`options.minDifference` cannot be negative');
        this.interval = millisecondsToMicroseconds(interval);
        this.maxInInterval = maxInInterval;
        this.minDifference = millisecondsToMicroseconds(minDifference);
    }
    /**
     * Attempts an action for the provided ID. Return information about whether the action was
     * allowed and why, and whether upcoming actions will be allowed.
     */
    async limitWithInfo(id) {
        const timestamps = await this.getTimestamps(id, true);
        return this.calculateInfo(timestamps);
    }
    /**
     * Returns information about what would happen if an action were attempted for the provided ID.
     */
    async wouldLimitWithInfo(id) {
        const existingTimestamps = await this.getTimestamps(id, false);
        const currentTimestamp = getCurrentMicroseconds();
        return this.calculateInfo([...existingTimestamps, currentTimestamp], true);
    }
    /**
     * Attempts an action for the provided ID. Returns whether it was blocked.
     */
    async limit(id) {
        return (await this.limitWithInfo(id)).blocked;
    }
    /**
     * Returns whether an action for the provided ID would be blocked, if it were attempted.
     */
    async wouldLimit(id) {
        return (await this.wouldLimitWithInfo(id)).blocked;
    }
    /**
     * Clears rate limiting state for the provided ID.
     */
    async clear(_id) {
        return Promise.reject(new Error('Not implemented'));
    }
    /**
     * Returns the list of timestamps of actions attempted within `interval` for the provided ID. If
     * `addNewTimestamp` flag is set, adds a new action with the current microsecond timestamp.
     */
    async getTimestamps(_id, _addNewTimestamp) {
        return Promise.reject(new Error('Not implemented'));
    }
    /**
     * Given a list of timestamps, computes the RateLimitingInfo. The last item in the list is the
     * timestamp of the current action.
     */
    calculateInfo(timestamps, isWould = false) {
        const numTimestamps = timestamps.length;
        const currentTimestamp = timestamps[numTimestamps - 1];
        const previousTimestamp = timestamps[numTimestamps - 2];
        const blockedDueToCount = numTimestamps > this.maxInInterval;
        const blockedDueToMinDifference = previousTimestamp != null &&
            // Only performs the check for positive `minDifference` values. The `currentTimestamp`
            // created by `wouldLimit` may possibly be smaller than `previousTimestamp` in a distributed 
            // environment.
            this.minDifference > 0 &&
            currentTimestamp - previousTimestamp < this.minDifference;
        const blocked = blockedDueToCount || blockedDueToMinDifference;
        // Always need to wait at least minDistance between consecutive actions.
        // If maxInInterval has been reached, also check how long will be required
        // until the interval is not full anymore.
        const microsecondsUntilUnblocked = numTimestamps >= this.maxInInterval
            ? timestamps[Math.max(0, numTimestamps - this.maxInInterval)] -
                currentTimestamp +
                this.interval
            : 0;
        const microsecondsUntilAllowed = Math.max(this.minDifference, microsecondsUntilUnblocked);
        if (isWould) {
            return {
                blocked,
                blockedDueToCount,
                blockedDueToMinDifference,
                millisecondsUntilAllowed: microsecondsToMilliseconds(timestamps[Math.max(0, numTimestamps - this.maxInInterval)] - currentTimestamp + this.interval),
                actionsRemaining: Math.max(0, this.maxInInterval - numTimestamps),
            };
        }
        return {
            blocked,
            blockedDueToCount,
            blockedDueToMinDifference,
            millisecondsUntilAllowed: microsecondsToMilliseconds(microsecondsUntilAllowed),
            actionsRemaining: Math.max(0, this.maxInInterval - numTimestamps),
        };
    }
}
exports.RateLimiter = RateLimiter;
/**
 * Rate limiter implementation that uses an object stored in memory for storage.
 */
class InMemoryRateLimiter extends RateLimiter {
    constructor(options) {
        super(options);
        this.storage = {};
        this.ttls = {};
    }
    async clear(id) {
        delete this.storage[id];
        const ttl = this.ttls[id];
        if (ttl) {
            clearTimeout(ttl);
            delete this.ttls[id];
        }
    }
    async getTimestamps(id, addNewTimestamp) {
        const currentTimestamp = getCurrentMicroseconds();
        // Update the stored timestamps, including filtering out old ones, and adding the new one.
        const clearBefore = currentTimestamp - this.interval;
        const storedTimestamps = (this.storage[id] || []).filter((t) => t > clearBefore);
        if (addNewTimestamp) {
            storedTimestamps.push(currentTimestamp);
            // Set a new TTL, and cancel the old one, if present.
            const ttl = this.ttls[id];
            if (ttl)
                clearTimeout(ttl);
            this.ttls[id] = setTimeout(() => {
                delete this.storage[id];
                delete this.ttls[id];
            }, microsecondsToMilliseconds(this.interval));
        }
        // Return the new stored timestamps.
        this.storage[id] = storedTimestamps;
        return storedTimestamps;
    }
}
exports.InMemoryRateLimiter = InMemoryRateLimiter;
/**
 * Rate limiter implementation that uses Redis for storage.
 */
class RedisRateLimiter extends RateLimiter {
    constructor({ client, namespace, ...baseOptions }) {
        super(baseOptions);
        this.ttl = microsecondsToSeconds(this.interval);
        this.client = client;
        this.namespace = namespace;
    }
    makeKey(id) {
        return `${this.namespace}${id}`;
    }
    async clear(id) {
        const key = this.makeKey(id);
        await this.client.del(key);
    }
    async getTimestamps(id, addNewTimestamp) {
        const now = getCurrentMicroseconds();
        const key = this.makeKey(id);
        const clearBefore = now - this.interval;
        const batch = this.client.multi();
        batch.zremrangebyscore(key, 0, clearBefore);
        if (addNewTimestamp) {
            batch.zadd(key, String(now), (0, uuid_1.v4)());
        }
        batch.zrange(key, 0, -1, 'WITHSCORES');
        batch.expire(key, this.ttl);
        return new Promise((resolve, reject) => {
            batch.exec((err, result) => {
                if (err)
                    return reject(err);
                const zRangeOutput = (addNewTimestamp ? result[2] : result[1]);
                const zRangeResult = this.getZRangeResult(zRangeOutput);
                const timestamps = this.extractTimestampsFromZRangeResult(zRangeResult);
                return resolve(timestamps);
            });
        });
    }
    getZRangeResult(zRangeOutput) {
        if (!Array.isArray(zRangeOutput[1])) {
            // Standard redis client, regular mode.
            return zRangeOutput;
        }
        else {
            // ioredis client.
            return zRangeOutput[1];
        }
    }
    extractTimestampsFromZRangeResult(zRangeResult) {
        // We only want the stored timestamps, which are the values, or the odd indexes.
        // Map to numbers because by default all returned values are strings.
        return zRangeResult.filter((e, i) => i % 2).map(Number);
    }
}
exports.RedisRateLimiter = RedisRateLimiter;
function getCurrentMicroseconds() {
    return microtime_1.default.now();
}
exports.getCurrentMicroseconds = getCurrentMicroseconds;
function millisecondsToMicroseconds(milliseconds) {
    return (1000 * milliseconds);
}
exports.millisecondsToMicroseconds = millisecondsToMicroseconds;
function microsecondsToMilliseconds(microseconds) {
    return Math.ceil(microseconds / 1000);
}
exports.microsecondsToMilliseconds = microsecondsToMilliseconds;
function microsecondsToSeconds(microseconds) {
    return Math.ceil(microseconds / 1000 / 1000);
}
exports.microsecondsToSeconds = microsecondsToSeconds;
