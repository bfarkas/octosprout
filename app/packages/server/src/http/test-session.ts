/** Test helper: signs in through the real passkey registration flow. */
import type { FastifyInstance } from "fastify";

import { FakeAuthenticator } from "../auth/fake-authenticator.js";

export const TEST_ORIGIN = "https://app.example.test";
export const TEST_RP_ID = "example.test";
export const TEST_SETUP_TOKEN = "setup-token-for-tests";

export async function signIn(app: FastifyInstance): Promise<{ cookie: string; csrf: string }> {
  const authenticator = new FakeAuthenticator(TEST_RP_ID, TEST_ORIGIN);
  const post = (url: string, payload: unknown) =>
    app.inject({ method: "POST", url, headers: { origin: TEST_ORIGIN, "content-type": "application/json" }, payload: JSON.stringify(payload) });
  const options = (await post("/api/v1/auth/register/options", { setup_token: TEST_SETUP_TOKEN })).json() as { challenge: string };
  const verified = await post("/api/v1/auth/register/verify", { setup_token: TEST_SETUP_TOKEN, response: authenticator.create(options) });
  return { cookie: (verified.headers["set-cookie"] as string).split(";")[0]!, csrf: (verified.json() as { csrf: string }).csrf };
}
