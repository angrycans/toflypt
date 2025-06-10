import * as dgram from "dgram";
import { SerialPort } from "serialport";
import { MavLinkPacketSplitter, MavLinkPacketParser } from "node-mavlink";

// substitute /dev/ttyACM0 with your serial port!
const port = new SerialPort({ path: "com21", baudRate: 115200 });

// constructing a reader that will emit each packet separately
const reader = port.pipe(new MavLinkPacketSplitter()).pipe(new MavLinkPacketParser());

const UDP_HOST = "127.0.0.1";
const UDP_PORT = 8081;

const client = dgram.createSocket("udp4");
const G = 9.81;

let xacc_ms2 = 0;
let yacc_ms2 = 0;
let zacc_ms2 = 0;
let roll = 0;
let pitch = 0;
let yaw = 0;
let rollspeed = 0;
let pitchspeed = 0;
let yawspeed = 0;
let roll_deg = 0;
let pitch_deg = 0;
let yaw_deg = 0;
let rollspeed_deg = 0;
let pitchspeed_deg = 0;
let yawspeed_deg = 0;

// Function to send data to the server
function sendData(
  xacc_ms2,
  yacc_ms2,
  zacc_ms2,
  roll_deg,
  pitch_deg,
  yaw_deg,
  rollspeed_deg,
  pitchspeed_deg,
  yawspeed_deg
) {
  const buffer = Buffer.alloc(36); // 6 floats * 4 bytes/float
  buffer.writeFloatLE(xacc_ms2, 0);
  buffer.writeFloatLE(yacc_ms2, 4);
  buffer.writeFloatLE(zacc_ms2, 8);
  buffer.writeFloatLE(roll_deg, 12);
  buffer.writeFloatLE(pitch_deg, 16);
  buffer.writeFloatLE(yaw_deg, 20);
  buffer.writeFloatLE(rollspeed_deg, 24);
  buffer.writeFloatLE(pitchspeed_deg, 28);
  buffer.writeFloatLE(yawspeed_deg, 32);

  client.send(buffer, UDP_PORT, UDP_HOST, (err) => {
    if (err) {
      console.error("UDP send error:", err);
    }
  });
}

reader.on("data", (packet) => {
  switch (packet.header.msgid) {
    case 26: // SCALED_IMU
      // Read accelerometer data (in mG)
      const xacc_mg = packet.payload.readInt16LE(4);
      const yacc_mg = packet.payload.readInt16LE(6);
      const zacc_mg = packet.payload.readInt16LE(8);

      // Read gyroscope data (in mrad/s)
      const xgyro_mrads = packet.payload.readInt16LE(10);
      const ygyro_mrads = packet.payload.readInt16LE(12);
      const zgyro_mrads = packet.payload.readInt16LE(14);

      // Read magnetometer data (in mgauss)
      const xmag = packet.payload.readInt16LE(16);
      const ymag = packet.payload.readInt16LE(18);
      const zmag = packet.payload.readInt16LE(20);

      // Read temperature data (in cdegC)
      const temperature = packet.payload.readInt16LE(22);

      // Read daoYaw data (in 0.1deg)
      const daoYaw = packet.payload.readInt16LE(24);

      // Convert accelerometer data to m/s^2
      xacc_ms2 = (xacc_mg / 1000.0) * G;
      yacc_ms2 = (yacc_mg / 1000.0) * G;
      zacc_ms2 = -(zacc_mg / 1000.0) * G;

      console.log("SCALED_IMU:");
      console.log("  time_boot_ms:", packet.payload.readUInt32LE(0));
      console.log("  xacc:", xacc_mg, "mG");
      console.log("  yacc:", yacc_mg, "mG");
      console.log("  zacc:", zacc_mg, "mG");
      console.log("  xgyro:", xgyro_mrads, "mrad/s");
      console.log("  ygyro:", ygyro_mrads, "mrad/s");
      console.log("  zgyro:", zgyro_mrads, "mrad/s");
      console.log("  xmag:", xmag, "mgauss");
      console.log("  ymag:", ymag, "mgauss");
      console.log("  zmag:", zmag, "mgauss");
      console.log("  temperature:", temperature, "cdegC");
      console.log("  daoYaw:", daoYaw, "0.1deg");
      break;

    case 30: // ATTITUDE
      // Read attitude data (in radians)
      roll = packet.payload.readFloatLE(4);
      pitch = packet.payload.readFloatLE(8);
      yaw = packet.payload.readFloatLE(12);
      rollspeed = packet.payload.readFloatLE(16);
      pitchspeed = packet.payload.readFloatLE(20);
      yawspeed = packet.payload.readFloatLE(24);

      // Convert roll, pitch, yaw, rollspeed, pitchspeed, and yawspeed to degrees
      roll_deg = (roll * 180) / Math.PI;
      pitch_deg = (pitch * 180) / Math.PI;
      yaw_deg = (yaw * 180) / Math.PI;
      rollspeed_deg = (rollspeed * 180) / Math.PI;
      pitchspeed_deg = (pitchspeed * 180) / Math.PI;
      yawspeed_deg = (yawspeed * 180) / Math.PI;

      // Send the converted data
      // sendData(roll_deg, pitch_deg, yaw_deg, rollspeed_deg, pitchspeed_deg, yawspeed_deg);
      //   sendData(roll, pitch, yaw, rollspeed, pitchspeed, yawspeed);

      break;
  }

  // sendData(xacc_ms2, yacc_ms2, zacc_ms2, roll, pitch, yaw, rollspeed, pitchspeed, yawspeed);
  // sendData(xacc_ms2, -yacc_ms2, zacc_ms2, roll, pitch, yaw, rollspeed, pitchspeed, yawspeed);
  sendData(xacc_ms2, -yacc_ms2, zacc_ms2, roll_deg, rollspeed_deg, pitch_deg, pitchspeed_deg, yaw_deg, yawspeed_deg);

  // sendData(xacc_ms2, yacc_ms2, zacc_ms2, roll_deg, pitch_deg, yaw_deg, rollspeed_deg, pitchspeed_deg, yawspeed_deg);
});

client.on("error", (err) => {
  console.error("Client error:", err);
  client.close();
});
