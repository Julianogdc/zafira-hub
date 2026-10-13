export const LOGGER_REDACTION_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["X-API-KEY"]',
  'res.headers["set-cookie"]',
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'secret',
  'clientSecret',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.apiKey',
  '*.secret',
  '*.clientSecret',
];

export interface LoggerConfigOptions {
  nodeEnv?: string;
  logLevel?: string;
}

export function getFastifyLoggerConfig(options?: LoggerConfigOptions) {
  const isRunningTests =
    process.env.NODE_ENV === 'test' ||
    process.env.npm_lifecycle_event === 'test' ||
    process.env.npm_lifecycle_event === 'test:integration:db';

  const nodeEnv = options?.nodeEnv ?? (isRunningTests ? 'test' : process.env.NODE_ENV);
  const logLevel = options?.logLevel ?? process.env.LOG_LEVEL ?? 'info';

  if (nodeEnv === 'test') {
    return false;
  }

  return {
    level: logLevel,
    redact: {
      paths: LOGGER_REDACTION_PATHS,
      censor: '[REDACTED]',
    },
  };
}
