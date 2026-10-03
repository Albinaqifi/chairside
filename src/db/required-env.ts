/** Reads a required environment variable, or fails with a message that says what to do. */
export function requiredEnv(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = env[name];
  if (!value) {
    throw new Error(`${name} is not set. Locally: copy .env.example to .env (see README.md).`);
  }
  return value;
}
