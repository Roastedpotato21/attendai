import type { DbQRSession, DbQRCheckIn } from "./schema";

interface ServerState {
  qrSessions: DbQRSession[];
  qrCheckIns: DbQRCheckIn[];
}

export const serverStore: ServerState = {
  qrSessions: [],
  qrCheckIns: [],
};

console.log("[QR SERVER STORE] Initialized server mock store");
