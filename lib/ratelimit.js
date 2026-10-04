// Simple in-memory request limiter, per IP and route. Used by the scoring endpoints and, when enabled, the login ones.
const attempts = new Map();

function rateLimit(max = 10, windowMs = 15 * 60 * 1000) {
  return (req, res, next) => {
    const key = req.ip + req.path;
    const now = Date.now();
    const rec = attempts.get(key);
    if (!rec || rec.reset < now) attempts.set(key, { n: 1, reset: now + windowMs });
    else if (++rec.n > max) return res.status(429).json({ error: 'Too many requests. Try again in a few minutes.' });
    next();
  };
}

module.exports = { rateLimit };
