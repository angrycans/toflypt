import * as dgram from 'dgram';
import { SerialPort } from 'serialport'
import { MavLinkPacketSplitter, MavLinkPacketParser } from 'node-mavlink'

// substitute /dev/ttyACM0 with your serial port!
const port = new SerialPort({ path: 'com21', baudRate: 115200 })

// constructing a reader that will emit each packet separately
const reader = port
  .pipe(new MavLinkPacketSplitter())
  .pipe(new MavLinkPacketParser())

const UDP_HOST = '127.0.0.1';
const UDP_PORT = 8081;

const client = dgram.createSocket('udp4');

// Function to send data to the server
function sendData(lateral_acceleration, longitudinal_acceleration, vertical_acceleration, yaw_speed, roll_position, pitch_position) {
  const buffer = Buffer.alloc(24); // 6 floats * 4 bytes/float
  buffer.writeFloatLE(lateral_acceleration, 0);
  buffer.writeFloatLE(longitudinal_acceleration, 4);
  buffer.writeFloatLE(vertical_acceleration, 8);
  buffer.writeFloatLE(yaw_speed, 12);
  buffer.writeFloatLE(roll_position, 16);
  buffer.writeFloatLE(pitch_position, 20);

  client.send(buffer, UDP_PORT, UDP_HOST, (err) => {
    if (err) {
      console.error('UDP send error:', err);
    }
  });
}

reader.on('data', packet => {
  // 根据你的 MAVLink 定义，提取所需的数据
  switch (packet.header.msgid) {
    case 26: // SCALED_IMU
      // 读取加速度计数据 (单位是 mG)
      const xacc_mg = packet.payload.readInt16LE(4);
      const yacc_mg = packet.payload.readInt16LE(6);
      const zacc_mg = packet.payload.readInt16LE(8);

      // 读取角速度数据 (单位是 mrad/s)
      const xgyro_mrads = packet.payload.readInt16LE(10);
      const ygyro_mrads = packet.payload.readInt16LE(12);
      const zgyro_mrads = packet.payload.readInt16LE(14);

      // 将加速度计数据转换为 m/s^2
      const G = 9.81; // 重力加速度
      const xacc_ms2 = (xacc_mg / 1000.0) * G; // Lateral acceleration
      const yacc_ms2 = (yacc_mg / 1000.0) * G; // Longitudinal acceleration
      const zacc_ms2 = (zacc_mg / 1000.0) * G; // Vertical acceleration

      // 将角速度数据转换为 °/s
      const xgyro_degs = xgyro_mrads * 180 / (Math.PI * 1000);
      const ygyro_degs = ygyro_mrads * 180 / (Math.PI * 1000);
      const zgyro_degs = zgyro_mrads * 180 / (Math.PI * 1000); // Yaw speed

      // Send data (roll and pitch are 0 for now, as they are not available in SCALED_IMU)
      sendData(xacc_ms2, yacc_ms2, zacc_ms2, zgyro_degs, 0, 0);
      break;

    case 30: // ATTITUDE
      const roll = packet.payload.readFloatLE(4); // Roll angle (rad)
      const pitch = packet.payload.readFloatLE(8); // Pitch angle (rad)
      const yawspeed = packet.payload.readFloatLE(16); // Yaw speed (rad/s)

      // Convert roll and pitch to degrees
      const roll_deg = roll * 180 / Math.PI;
      const pitch_deg = pitch * 180 / Math.PI;

      // Convert yawspeed to deg/s
      const yawspeed_deg = yawspeed * 180 / Math.PI;

      // Send data (accelerations are 0 for now, as they are not available in ATTITUDE)
      sendData(0, 0, 0, yawspeed_deg, roll_deg, pitch_deg);
      break;

    case 31: // ATTITUDE_QUATERNION
      const rollspeed = packet.payload.readFloatLE(16); // Roll angular speed (rad/s)
      const pitchspeed = packet.payload.readFloatLE(20); // Pitch angular speed (rad/s)
      const yawspeed_quat = packet.payload.readFloatLE(24); // Yaw angular speed (rad/s)

      // Convert angular speeds to deg/s
      const rollspeed_deg = rollspeed * 180 / Math.PI;
      const pitchspeed_deg = pitchspeed * 180 / Math.PI;
      const yawspeed_deg_quat = yawspeed_quat * 180 / Math.PI;

      // Send data (accelerations and angles are 0 for now, as they are not available in ATTITUDE_QUATERNION)
      sendData(0, 0, 0, yawspeed_deg_quat, 0, 0);
      break;
  }
});

client.on('error', (err) => {
  console.error('Client error:', err);
  client.close();
});