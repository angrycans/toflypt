import * as dgram from 'dgram';

const client = dgram.createSocket('udp4');
const message = Buffer.from('Hello from client!'); // Send a message to initiate the connection
const UDP_HOST = '127.0.0.1';
const UDP_PORT = 8081;

client.send(message, UDP_PORT, UDP_HOST, (err) => {
  if (err) {
    console.error('Error sending message:', err);
  } else {
    console.log('Sent message to server');
  }
});

client.on('message', (msg, rinfo) => {
  const x = msg.readFloatLE(0);
  const y = msg.readFloatLE(4);
  const z = msg.readFloatLE(8);
  console.log(`Received data from server: X=${x}, Y=${y}, Z=${z}`);
});

client.on('error', (err) => {
  console.error('Client error:', err);
  client.close();
});