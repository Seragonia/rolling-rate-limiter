# Rolling Rate Limiter
[![Build Status](https://travis-ci.org/classdojo/rolling-rate-limiter.svg?branch=master)](https://travis-ci.org/classdojo/rolling-rate-limiter)

## Description
This is an implementation of a rate limiter in node.js that allows for rate limiting with a rolling window.  This means that if a user is allowed 5 actions per 60 seconds, any action will be blocked if 5 actions have already occured in the preceeding 60 seconds, without any set points at which this interval resets.  This contrasts with many existing implementations, in which a user could make 5 requests at 0:59 and another 5 requests at 1:01.  The implementation uses what I believe to be a novel algorithm, using sorted sets.  It can use either in-memory storage or Redis as a backend.

## Examples

### In memory
```javascript
  
  var RateLimiter = require("rolling-rate-limiter");

  var limiter = RateLimiter({
    interval: 1000 // in miliseconds
    maxInInterval: 10
    minDifference: 100 // optional: the minimum time (in miliseconds) between any two actions
  });

  // First argument should be a unique identifier for a user.
  // If the limiter does not differentiate between users, pass only a callback.
  limiter("user1234", function(err, success) {
    // errors if redis connection failed, etc
    if (err) throw err;

    if (success) {
      // limit was not exceeded, action should be allowed
    } else {
      // limit was exceeded, action should not be allowed
    }
  });

```

### With a redis backend
This allows multiple processes (e.g. multiple instances of a server application) to use a single redis to share rate limiter state.  Make sure that the limiters have identical configurations in each instance.
```javascript
  
  var RateLimiter = require("rolling-rate-limiter");
  var Redis = require("redis");
  var client = Redis.createClient(config);

  var limiter = RateLimiter({
    redis: client,
    namespace: "UserLoginLimiter" // optional: allows one redis instance to handle multiple types of rate limiters. defaults to "rate-limiter-{string of 8 random characters}"
    interval: 1000
    maxInInterval: 10
    minDifference: 100
  });

  // operation same as above.

```

### As a middleware
You can easily use this module to set up a request rate limiter middleware in Express.
```javascript

  var limiter = RateLimiter({
    redis: redisClient,
    namespace: "requestRateLimiter",
    interval: 60000,
    maxInInterval: 100,
    minDifference: 100
  });

  app.use(function(req, res, next) {

    // "req.ipAddress" could be replaced with any unique user identifier
    limiter(req.ipAddress, function(err, success) {
      if (err) {
        return res.status(500).send();
      } else if (!success) {
        return res.status(429).send();
      } else {
        return next();
      }
    });

  });

```

## Method of operation
  * Each identifier/user corresponds to a __sorted set__ data structure.  The keys and values are both equal to the (microsecond) times at which actions were attempted, allowing easy manipulation of this list.
  * When a new action comes in for a user, all elements in the set that occurred earlier than (current time - interval) are dropped from the set. 
  * If the number of elements in the set is still greater than the maximum, the current action is blocked.
  * If a minimum difference has been set and the most recent previous element is too close to the current time, the current action is blocked.
  * The current action is then added to the set.
  * __Note__: if an action is blocked, it is still added to the set.  This means that if a user is continually attempting actions more quickly than the allowed rate, __all__ of their actions will be blocked until they pause or slow their requests.
  * If the limiter uses a redis instance, the keys are prefixed with namespace, allowing a single redis instance to support separate rate limiters.
  * All redis operations for a single rate-limit check/update are performed as an atomic transaction, allowing rate limiters running on separate processes or machines to share state safely.
