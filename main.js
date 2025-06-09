import * as dgram from 'dgram';
import { SerialPort } from 'serialport'
import { MavLinkPacketSplitter, MavLinkPacketParser } from 'node-mavlink'

// substitute /dev/ttyACM0 with your serial port!
const port = new SerialPort({ path: '/dev/cu.usbmodem1234561', baudRate: 115200 })

// constructing a reader that will emit each packet separately
const reader = port
  .pipe(new MavLinkPacketSplitter())
  .pipe(new MavLinkPacketParser())

const UDP_HOST = '127.0.0.1'; // Listen on localhost
const UDP_PORT = 8081;

const server = dgram.createSocket('udp4');

let clientAddress = null;
let clientPort = null;

server.on('error', (err) => {
  console.error('UDP server error:', err);
  server.close();
});

server.on('message', (msg, rinfo) => {
  // 接收到客户端的消息时，记录客户端的地址和端口
  clientAddress = rinfo.address;
  clientPort = rinfo.port;
  console.log(`Client connected: ${clientAddress}:${clientPort}`);
});

server.on('listening', () => {
  const address = server.address();
  console.log(`UDP server listening on ${address.address}:${address.port}`);
});

server.bind(UDP_PORT, UDP_HOST);

// Function to send IMU data to the client
function sendImuData(x, y, z) {
  if (clientAddress && clientPort) {
    const buffer = Buffer.alloc(12);
    buffer.writeFloatLE(x, 0);
    buffer.writeFloatLE(y, 4);
    buffer.writeFloatLE(z, 8);

    server.send(buffer, clientPort, clientAddress, (err) => {
      if (err) {
        console.error('UDP send error:', err);
      }
    });
  }
}

reader.on('data', packet => {
  // 检查消息 ID 是否为 SCALED_IMU (假设 ID 为 26)
  if (packet.header.msgid === 26) { // SCALED_IMU
    // 读取加速度计数据 (单位是 mG)
    const xacc_mg = packet.payload.readInt16LE(4);
    const yacc_mg = packet.payload.readInt16LE(6);
    const zacc_mg = packet.payload.readInt16LE(8);

    // 将加速度计数据转换为 g (重力加速度)
    const xacc_g = xacc_mg / 1000.0;
    const yacc_g = yacc_mg / 1000.0;
    const zacc_g = zacc_mg / 1000.0;

    // 将加速度计数据转换为 m/s^2
    const G = 9.81; // 重力加速度
    const xacc_ms2 = xacc_g * G;
    const yacc_ms2 = yacc_g * G;
    const zacc_ms2 = zacc_g * G;

    // Send IMU data to the connected client
    sendImuData(xacc_ms2, yacc_ms2, zacc_ms2);
  }
});