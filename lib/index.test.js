"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ioredis_1 = __importDefault(require("ioredis"));
const microtime_1 = __importDefault(require("microtime"));
const redis_1 = __importDefault(require("redis"));
const _1 = require(".");
describe('options validation', () => {
    let options;
    beforeEach(() => {
        options = {
            interval: 10000,
            maxInInterval: 5,
            minDifference: 500,
        };
    });
    it('throws if interval is missing', () => {
        // @ts-expect-error - simulate a bad options object
        delete options.interval;
        expect(() => new _1.RateLimiter(options)).toThrow();
    });
    it('throws if maxInInterval is missing', () => {
        // @ts-expect-error - simulate a bad options object
        delete options.maxInInterval;
        expect(() => new _1.RateLimiter(options)).toThrow();
    });
    it('throws if interval is zero', () => {
        options.interval = 0;
        expect(() => new _1.RateLimiter(options)).toThrow();
    });
    it('throws if interval is negative', () => {
        options.interval = -1;
        expect(() => new _1.RateLimiter(options)).toThrow();
    });
    it('throws if maxInInterval is zero', () => {
        options.maxInInterval = 0;
        expect(() => new _1.RateLimiter(options)).toThrow();
    });
    it('throws if maxInInterval is negative', () => {
        options.maxInInterval = -1;
        expect(() => new _1.RateLimiter(options)).toThrow();
    });
    it('throws if minDifference is negative', () => {
        options.minDifference = -1;
        expect(() => new _1.RateLimiter(options)).toThrow();
    });
    it('passes if minDifference is missing', () => {
        delete options.minDifference;
        expect(() => new _1.RateLimiter(options)).not.toThrow();
    });
    it('passes if minDifference is zero', () => {
        options.minDifference = 0;
        expect(() => new _1.RateLimiter(options)).not.toThrow();
    });
    it('passes with full options', () => {
        expect(() => new _1.RateLimiter(options)).not.toThrow();
    });
});
describe('RateLimiter implementations', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.runAllTimers());
    let currentTime = 0;
    function setTime(timeInMilliseconds) {
        jest
            .spyOn(microtime_1.default, 'now')
            .mockImplementation(() => (0, _1.millisecondsToMicroseconds)(timeInMilliseconds));
        jest.advanceTimersByTime(Math.max(0, timeInMilliseconds - currentTime));
        currentTime = timeInMilliseconds;
    }
    function sharedExamples(_createLimiter) {
        const id = 1;
        const id2 = 2;
        async function createLimiter(options) {
            const limiter = _createLimiter(options);
            await limiter.clear(id);
            await limiter.clear(id2);
            return limiter;
        }
        it('prevents more than maxInInterval actions within interval', async () => {
            const options = { interval: 10, maxInInterval: 2 };
            const limiter = await createLimiter(options);
            // Should allow first action through.
            setTime(0);
            expect(await limiter.limit(id)).toBe(false);
            // Should allow second action through.
            setTime(1);
            expect(await limiter.wouldLimit(id)).toBe(false);
            expect(await limiter.limit(id)).toBe(false);
            // Would not allow third action through, since not enough time has passed.
            // Don't actually run this one.
            setTime(options.interval - 1);
            expect(await limiter.wouldLimit(id)).toBe(true);
            // Now only one action in the last 10 ms, so we're ok.
            setTime(options.interval);
            expect(await limiter.wouldLimit(id)).toBe(false);
            expect(await limiter.limit(id)).toBe(false);
        });
        it('blocked actions count as actions', async () => {
            const options = { interval: 10, maxInInterval: 3 };
            const limiter = await createLimiter(options);
            // Block this id.
            setTime(0);
            await limiter.limit(id);
            await limiter.limit(id);
            await limiter.limit(id);
            // `interval` time has not passed, so we should still block all actions.
            setTime(options.interval - 1);
            expect(await limiter.limit(id)).toBe(true);
            expect(await limiter.limit(id)).toBe(true);
            // The first 3 actions have cleared, but two still remain, so we should
            // only allow one more.
            setTime(options.interval);
            expect(await limiter.limit(id)).toBe(false);
            expect(await limiter.limit(id)).toBe(true);
        });
        it('prevents actions less than minDistance apart', async () => {
            const options = { interval: 10, maxInInterval: 4, minDifference: 2 };
            const limiter = await createLimiter(options);
            // Can't do a second thing at time 0 because of minDifference
            setTime(0);
            expect(await limiter.limit(id)).toBe(false);
            expect(await limiter.limit(id)).toBe(true);
            // Can't do anything at time 1 because of minDifference
            setTime(1);
            expect(await limiter.limit(id)).toBe(true);
            // Can do 1 thing at time 3 because minDifference is ok now, but
            // can't do a second thing because of maxInInterval
            setTime(3);
            expect(await limiter.limit(id)).toBe(false);
            expect(await limiter.limit(id)).toBe(true);
        });
        it('keeps separate counts for separate users', async () => {
            const options = { interval: 5, maxInInterval: 2 };
            const limiter = await createLimiter(options);
            setTime(0);
            expect(await limiter.limit(id)).toBe(false);
            expect(await limiter.limit(id)).toBe(false);
            expect(await limiter.limit(id)).toBe(true);
            setTime(1);
            expect(await limiter.limit(id2)).toBe(false);
            expect(await limiter.limit(id2)).toBe(false);
            expect(await limiter.limit(id2)).toBe(true);
            setTime(5);
            expect(await limiter.limit(id)).toBe(false);
            expect(await limiter.limit(id2)).toBe(true);
        });
        it('returns info about limiting (no min distance)', async () => {
            const options = { interval: 10, maxInInterval: 3 };
            const limiter = await createLimiter(options);
            setTime(0);
            expect(await limiter.limitWithInfo(id)).toEqual({
                blocked: false,
                blockedDueToCount: false,
                blockedDueToMinDifference: false,
                millisecondsUntilAllowed: 0,
                actionsRemaining: 2,
            });
            setTime(4);
            expect(await limiter.limitWithInfo(id)).toEqual({
                blocked: false,
                blockedDueToCount: false,
                blockedDueToMinDifference: false,
                millisecondsUntilAllowed: 0,
                actionsRemaining: 1,
            });
            setTime(5);
            expect(await limiter.limitWithInfo(id)).toEqual({
                blocked: false,
                blockedDueToCount: false,
                blockedDueToMinDifference: false,
                millisecondsUntilAllowed: 5,
                actionsRemaining: 0,
            });
            setTime(8);
            expect(await limiter.limitWithInfo(id)).toEqual({
                blocked: true,
                blockedDueToCount: true,
                blockedDueToMinDifference: false,
                millisecondsUntilAllowed: 6,
                actionsRemaining: 0,
            });
            setTime(11);
            expect(await limiter.wouldLimitWithInfo(id)).toEqual({
                blocked: true,
                blockedDueToCount: true,
                blockedDueToMinDifference: false,
                millisecondsUntilAllowed: 4,
                actionsRemaining: 0,
            });
            setTime(17);
            expect(await limiter.wouldLimitWithInfo(id)).toEqual({
                blocked: false,
                blockedDueToCount: false,
                blockedDueToMinDifference: false,
                millisecondsUntilAllowed: 0,
                actionsRemaining: 1,
            });
        });
        it('returns info about limiting (with min distance)', async () => {
            const options = { interval: 10, maxInInterval: 3, minDifference: 2 };
            const limiter = await createLimiter(options);
            setTime(0);
            expect(await limiter.limitWithInfo(id)).toEqual({
                blocked: false,
                blockedDueToCount: false,
                blockedDueToMinDifference: false,
                millisecondsUntilAllowed: 2,
                actionsRemaining: 2,
            });
            setTime(4);
            expect(await limiter.limitWithInfo(id)).toEqual({
                blocked: false,
                blockedDueToCount: false,
                blockedDueToMinDifference: false,
                millisecondsUntilAllowed: 2,
                actionsRemaining: 1,
            });
            setTime(5);
            expect(await limiter.limitWithInfo(id)).toEqual({
                blocked: true,
                blockedDueToCount: false,
                blockedDueToMinDifference: true,
                millisecondsUntilAllowed: 5,
                actionsRemaining: 0,
            });
            setTime(8);
            expect(await limiter.limitWithInfo(id)).toEqual({
                blocked: true,
                blockedDueToCount: true,
                blockedDueToMinDifference: false,
                millisecondsUntilAllowed: 6,
                actionsRemaining: 0,
            });
            setTime(11);
            expect(await limiter.wouldLimitWithInfo(id)).toEqual({
                blocked: true,
                blockedDueToCount: true,
                blockedDueToMinDifference: false,
                millisecondsUntilAllowed: 4,
                actionsRemaining: 0,
            });
            setTime(17);
            expect(await limiter.wouldLimitWithInfo(id)).toEqual({
                blocked: false,
                blockedDueToCount: false,
                blockedDueToMinDifference: false,
                millisecondsUntilAllowed: 2,
                actionsRemaining: 1,
            });
        });
    }
    describe('InMemoryRateLimiter', () => {
        sharedExamples((opts) => new _1.InMemoryRateLimiter(opts));
    });
    describe('RedisRateLimiter (`redis` client)', () => {
        let client;
        beforeEach(() => {
            client = redis_1.default.createClient();
        });
        afterEach((cb) => client.quit(cb));
        sharedExamples((opts) => new _1.RedisRateLimiter({
            client,
            namespace: 'rolling-rate-limiter-redis',
            ...opts,
        }));
    });
    describe('RedisRateLimiter (`redis` client, `return_buffers` enabled)', () => {
        let client;
        beforeEach(() => {
            client = redis_1.default.createClient({ return_buffers: true });
        });
        afterEach((cb) => client.quit(cb));
        sharedExamples((opts) => new _1.RedisRateLimiter({
            client,
            namespace: 'rolling-rate-limiter-redis',
            ...opts,
        }));
    });
    describe('RedisRateLimiter (`ioredis` client)', () => {
        let client;
        beforeEach(() => {
            client = new ioredis_1.default();
        });
        afterEach((cb) => client.quit(cb));
        sharedExamples((opts) => new _1.RedisRateLimiter({
            client,
            namespace: 'rolling-rate-limiter-ioredis',
            ...opts,
        }));
    });
});
