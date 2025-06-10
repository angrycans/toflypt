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

// Gravity constant
const G = 9.81;

// Variables to store IMU and attitude data
let xacc_ms2 = 0;
let yacc_ms2 = 0;
let zacc_ms2 = 0;
let roll = 0;
let pitch = 0;
let yaw = 0;

// Function to send data to the server
function sendData(lateral_speed, lateral_acceleration, lateral_acc_with_gravity, lateral_gravity,
                  longitudinal_speed, longitudinal_acceleration, longitudinal_acc_with_gravity, longitudinal_gravity,
                  vertical_speed, vertical_acceleration, vertical_acc_with_gravity, vertical_gravity) {
  const buffer = Buffer.alloc(48); // 12 floats * 4 bytes/float
  buffer.writeFloatLE(lateral_speed, 0);
  buffer.writeFloatLE(lateral_acceleration, 4);
  buffer.writeFloatLE(lateral_acc_with_gravity, 8);
  buffer.writeFloatLE(lateral_gravity, 12);
  buffer.writeFloatLE(longitudinal_speed, 16);
  buffer.writeFloatLE(longitudinal_acceleration, 20);
  buffer.writeFloatLE(longitudinal_acc_with_gravity, 24);
  buffer.writeFloatLE(longitudinal_gravity, 28);
  buffer.writeFloatLE(vertical_speed, 32);
  buffer.writeFloatLE(vertical_acceleration, 36);
  buffer.writeFloatLE(vertical_acc_with_gravity, 40);
  buffer.writeFloatLE(vertical_gravity, 44);

  client.send(buffer, UDP_PORT, UDP_HOST, (err) => {
    if (err) {
      console.error('UDP send error:', err);
    }
  });
}

reader.on('data', packet => {
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
      zacc_ms2 = (zacc_mg / 1000.0) * G;

      console.log('SCALED_IMU:');
      console.log('  time_boot_ms:', packet.payload.readUInt32LE(0));
      console.log('  xacc:', xacc_mg, 'mG');
      console.log('  yacc:', yacc_mg, 'mG');
      console.log('  zacc:', zacc_mg, 'mG');
      console.log('  xgyro:', xgyro_mrads, 'mrad/s');
      console.log('  ygyro:', ygyro_mrads, 'mrad/s');
      console.log('  zgyro:', zgyro_mrads, 'mrad/s');
      console.log('  xmag:', xmag, 'mgauss');
      console.log('  ymag:', ymag, 'mgauss');
      console.log('  zmag:', zmag, 'mgauss');
      console.log('  temperature:', temperature, 'cdegC');
      console.log('  daoYaw:', daoYaw, '0.1deg');
      break;

    case 30: // ATTITUDE
      // Read attitude data (in radians)
      roll = packet.payload.readFloatLE(4);
      pitch = packet.payload.readFloatLE(8);
      yaw = packet.payload.readFloatLE(12);
      const rollspeed = packet.payload.readFloatLE(16);
      const pitchspeed = packet.payload.readFloatLE(20);
      const yawspeed = packet.payload.readFloatLE(24);

      console.log('ATTITUDE:');
      console.log('  time_boot_ms:', packet.payload.readUInt32LE(0));
      console.log('  roll:', roll, 'rad');
      console.log('  pitch:', pitch, 'rad');
      console.log('  yaw:', yaw, 'rad');
      console.log('  rollspeed:', rollspeed, 'rad/s');
      console.log('  pitchspeed:', pitchspeed, 'rad/s');
      console.log('  yawspeed:', yawspeed, 'rad/s');
      break;

    case 31: // ATTITUDE_QUATERNION
      const q1 = packet.payload.readFloatLE(4);
      const q2 = packet.payload.readFloatLE(8);
      const q3 = packet.payload.readFloatLE(12);
      const q4 = packet.payload.readFloatLE(16);
      const rollspeed_quat = packet.payload.readFloatLE(20);
      const pitchspeed_quat = packet.payload.readFloatLE(24);
      const yawspeed_quat = packet.payload.readFloatLE(28);

      console.log('ATTITUDE_QUATERNION:');
      console.log('  time_boot_ms:', packet.payload.readUInt32LE(0));
      console.log('  q1:', q1);
      console.log('  q2:', q2);
      console.log('  q3:', q3);
      console.log('  q4:', q4);
      console.log('  rollspeed:', rollspeed_quat, 'rad/s');
      console.log('  pitchspeed:', pitchspeed_quat, 'rad/s');
      console.log('  yawspeed:', yawspeed_quat, 'rad/s');
      break;

    case 32: // LOCAL_POSITION_NED
      const x = packet.payload.readFloatLE(4);
      const y = packet.payload.readFloatLE(8);
      const z = packet.payload.readFloatLE(12);
      const vx = packet.payload.readFloatLE(16);
      const vy = packet.payload.readFloatLE(20);
      const vz = packet.payload.readFloatLE(24);

      console.log('LOCAL_POSITION_NED:');
      console.log('  time_boot_ms:', packet.payload.readUInt32LE(0));
      console.log('  x:', x, 'm');
      console.log('  y:', y, 'm');
      console.log('  z:', z, 'm');
      console.log('  vx:', vx, 'm/s');
      console.log('  vy:', vy, 'm/s');
      console.log('  vz:', vz, 'm/s');
      break;

    case 33: // GLOBAL_POSITION_INT
      const lat = packet.payload.readInt32LE(4);
      const lon = packet.payload.readInt32LE(8);
      const alt = packet.payload.readInt32LE(12);
      const relative_alt = packet.payload.readInt32LE(16);
      const vx_global = packet.payload.readInt16LE(20);
      const vy_global = packet.payload.readInt16LE(22);
      const vz_global = packet.payload.readInt16LE(24);
      const hdg = packet.payload.readUInt16LE(26);

      console.log('GLOBAL_POSITION_INT:');
      console.log('  time_boot_ms:', packet.payload.readUInt32LE(0));
      console.log('  lat:', lat, 'degE7');
      console.log('  lon:', lon, 'degE7');
      console.log('  alt:', alt, 'mm');
      console.log('  relative_alt:', relative_alt, 'mm');
      console.log('  vx:', vx_global, 'cm/s');
      console.log('  vy:', vy_global, 'cm/s');
      console.log('  vz:', vz_global, 'cm/s');
      console.log('  hdg:', hdg, 'cdeg');
      break;

    default:
      //console.log('Unknown MAVLink message with ID:', packet.header.msgid);
  }

  // Calculate gravity components in each axis
  const lateral_gravity = G * Math.sin(roll);
  const longitudinal_gravity = -G * Math.sin(pitch) * Math.cos(roll);
  const vertical_gravity = G * Math.cos(pitch) * Math.cos(roll);

  // Calculate acceleration with gravity
  const lateral_acc_with_gravity = xacc_ms2 + lateral_gravity;
  const longitudinal_acc_with_gravity = yacc_ms2 + longitudinal_gravity;
  const vertical_acc_with_gravity = zacc_ms2 + vertical_gravity;

  // Assuming speeds are not directly available from IMU or attitude
  const lateral_speed = 0;
  const longitudinal_speed = 0;
  const vertical_speed = 0;

  // Send the calculated data
  sendData(lateral_speed, xacc_ms2, lateral_acc_with_gravity, lateral_gravity,
           longitudinal_speed, yacc_ms2, longitudinal_acc_with_gravity, longitudinal_gravity,
           vertical_speed, zacc_ms2, vertical_acc_with_gravity, vertical_gravity);
});

client.on('error', (err) => {
  console.error('Client error:', err);
  client.close();
});
