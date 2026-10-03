// Request validation (zod). Error messages are shown to the user, so keep them friendly.
const { z } = require('zod');

const email = z.string({ error: 'Enter a valid email address.' }).trim().toLowerCase()
  .pipe(z.string().max(254, 'Enter a valid email address.').regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Enter a valid email address.'));
const newPassword = z.string({ error: 'Password must be at least 8 characters.' })
  .min(8, 'Password must be at least 8 characters.')
  .max(200, 'Password is too long (max 200 characters).');
const anyPassword = z.string().min(1).max(200);

const signup = z.object({ email, password: newPassword });
const login = z.object({ email, password: anyPassword });
const forgot = z.object({ email });
const reset = z.object({ token: z.string().min(10).max(200), password: newPassword });
const rescore = z.object({
  resume: z.string().min(100, 'The resume text is too short to score.').max(100000, 'The resume text is too long.'),
  jd: z.string().min(40, 'The job description is too short.').max(50000, 'The job description is too long.'),
});
const exportDocx = z.object({
  text: z.string().min(10, 'Nothing to export.').max(100000, 'The resume text is too long.'),
  template: z.enum(['modern', 'classic', 'minimal']).default('modern'),
});
const deleteAccount = z.object({ password: anyPassword });

// Express middleware: validates req.body, stores the parsed value on req.data, or replies 400.
const validate = (schema, badMessage) => (req, res, next) => {
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: badMessage || parsed.error.issues[0]?.message || 'Invalid request.' });
  req.data = parsed.data;
  next();
};

module.exports = { signup, login, forgot, reset, deleteAccount, rescore, exportDocx, validate };
