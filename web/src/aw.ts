// The one Appwrite client for the browser. Visitors get an anonymous session; every action goes through the api Function.
import { Client, Account, Functions, TablesDB, Realtime } from "appwrite";

export const DB = "backroom";
export const client = new Client().setEndpoint(import.meta.env.VITE_APPWRITE_ENDPOINT).setProject(import.meta.env.VITE_APPWRITE_PROJECT_ID);
export const account = new Account(client);
export const tables = new TablesDB(client);
export const realtime = new Realtime(client);
const functions = new Functions(client);

export async function ensureSession() {
  try { return await account.get(); }
  catch { await account.createAnonymousSession(); return account.get(); }
}

export class ApiCallError extends Error { constructor(readonly status: number, message: string, readonly code?: string) { super(message); } }
export const DEMO_CIRCLE = import.meta.env.VITE_DEMO_CIRCLE_ID as string | undefined;

// Calls an api action synchronously and returns its JSON, throwing the api's own error message on failure.
export async function call<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const ex = await functions.createExecution({ functionId: "api", body: JSON.stringify({ action, ...body }), async: false });
  const data = JSON.parse(ex.responseBody || "{}");
  if (ex.responseStatusCode >= 400) throw new ApiCallError(ex.responseStatusCode, data.error ?? "request failed", data.code);
  return data as T;
}
