import os from "os";
import fs from "fs";
import path from "path";

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "localhost";
}

const ip = getLocalIp();
const targetPath = path.join(process.cwd(), "src", "lib", "local-ip.ts");
fs.writeFileSync(targetPath, `export const LOCAL_IP = "${ip}";\n`);
console.log("Generated src/lib/local-ip.ts with IP:", ip);
