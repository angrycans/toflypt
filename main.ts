import { parseArgs } from "@std/cli/parse-args";
import { cyan, green, red, yellow } from "@std/fmt/colors";
import { dirname, join, resolve } from "@std/path";
import dgram from "node:dgram";
import type { RemoteInfo } from "node:dgram";

type InputMode = "serial" | "udp";
type Parity = "none" | "even" | "odd";
type LoadedConfig = {
  config: AppConfig;
  path: string;
};

type AppConfig = {
  input: {
    mode: InputMode;
    serial: {
      path: string;
      baudRate: number;
      dataBits: 8 | 7 | 6 | 5;
      stopBits: 1 | 2;
      parity: Parity;
    };
    udp: {
      host: string;
      port: number;
    };
  };
  flypt: {
    host: string;
    port: number;
    enabled: boolean;
  };
  display: {
    pretty: boolean;
    showTimestamp: boolean;
  };
};

type MotionFrame = {
  swayAcc: number;
  surgeAcc: number;
  heaveAcc: number;
  rollPos: number;
  pitchPos: number;
  yawPos: number;
  rollSpeed: number;
  pitchSpeed: number;
  yawSpeed: number;
};

const FRAME_HEADER_1 = 0xaa;
const FRAME_HEADER_2 = 0x55;
const FRAME_FOOTER_1 = 0x0d;
const FRAME_FOOTER_2 = 0x0a;
const PAYLOAD_LENGTH = 36;
const FRAME_LENGTH = 42;
const GRAVITY = 9.80665;

function getTimestamp(enabled: boolean): string {
  return enabled ? `[${new Date().toISOString()}] ` : "";
}

function checksum(payload: Uint8Array): number {
  let sum = 0;
  for (const byte of payload) {
    sum = (sum + byte) & 0xff;
  }
  return sum;
}

function parseFrame(frameBytes: Uint8Array): MotionFrame | null {
  if (frameBytes.length !== FRAME_LENGTH) {
    return null;
  }

  if (
    frameBytes[0] !== FRAME_HEADER_1 ||
    frameBytes[1] !== FRAME_HEADER_2 ||
    frameBytes[2] !== PAYLOAD_LENGTH ||
    frameBytes[40] !== FRAME_FOOTER_1 ||
    frameBytes[41] !== FRAME_FOOTER_2
  ) {
    return null;
  }

  const payload = frameBytes.slice(3, 39);
  if (checksum(payload) !== frameBytes[39]) {
    return null;
  }

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const values: number[] = [];
  for (let offset = 0; offset < PAYLOAD_LENGTH; offset += 4) {
    values.push(view.getFloat32(offset, true));
  }

  return {
    swayAcc: values[0],
    surgeAcc: values[1],
    heaveAcc: values[2],
    rollPos: values[3],
    pitchPos: values[4],
    yawPos: values[5],
    rollSpeed: values[6],
    pitchSpeed: values[7],
    yawSpeed: values[8],
  };
}

function compensateGravity(frame: MotionFrame): MotionFrame {
  const rollRad = frame.rollPos * Math.PI / 180;
  const pitchRad = frame.pitchPos * Math.PI / 180;

  const gravitySway = GRAVITY * Math.sin(rollRad);
  const gravitySurge = -GRAVITY * Math.sin(pitchRad);
  const gravityHeave = GRAVITY * Math.cos(rollRad) * Math.cos(pitchRad);

  return {
    ...frame,
    swayAcc: frame.swayAcc - gravitySway,
    surgeAcc: frame.surgeAcc - gravitySurge,
    heaveAcc: frame.heaveAcc - gravityHeave,
  };
}

function formatFrame(frame: MotionFrame, pretty: boolean): string {
  if (!pretty) {
    return JSON.stringify(frame);
  }

  const values = [
    frame.swayAcc,
    frame.surgeAcc,
    frame.heaveAcc,
    frame.rollPos,
    frame.pitchPos,
    frame.yawPos,
    frame.rollSpeed,
    frame.pitchSpeed,
    frame.yawSpeed,
  ].map((value) => value.toFixed(4));

  return [
    `swayAcc=${values[0]}`,
    `surgeAcc=${values[1]}`,
    `heaveAcc=${values[2]}`,
    `rollPos=${values[3]}`,
    `pitchPos=${values[4]}`,
    `yawPos=${values[5]}`,
    `rollSpeed=${values[6]}`,
    `pitchSpeed=${values[7]}`,
    `yawSpeed=${values[8]}`,
  ].join(" | ");
}

function buildFlyPtPacket(frame: MotionFrame): Uint8Array {
  const packet = new Uint8Array(FRAME_LENGTH);
  packet[0] = FRAME_HEADER_1;
  packet[1] = FRAME_HEADER_2;
  packet[2] = PAYLOAD_LENGTH;

  const payload = new Uint8Array(PAYLOAD_LENGTH);
  const view = new DataView(payload.buffer);
  const values = [
    frame.swayAcc,
    frame.surgeAcc,
    frame.heaveAcc,
    frame.rollPos,
    frame.pitchPos,
    frame.yawPos,
    frame.rollSpeed,
    frame.pitchSpeed,
    frame.yawSpeed,
  ];

  values.forEach((value, index) => view.setFloat32(index * 4, value, true));
  packet.set(payload, 3);
  packet[39] = checksum(payload);
  packet[40] = FRAME_FOOTER_1;
  packet[41] = FRAME_FOOTER_2;

  return packet;
}

class FrameBuffer {
  private buffer = new Uint8Array(0);

  push(chunk: Uint8Array): MotionFrame[] {
    const merged = new Uint8Array(this.buffer.length + chunk.length);
    merged.set(this.buffer, 0);
    merged.set(chunk, this.buffer.length);
    this.buffer = merged;

    const frames: MotionFrame[] = [];

    while (this.buffer.length >= FRAME_LENGTH) {
      const start = this.findHeader(this.buffer);
      if (start < 0) {
        this.buffer = this.buffer.slice(Math.max(0, this.buffer.length - 1));
        break;
      }

      if (start > 0) {
        this.buffer = this.buffer.slice(start);
      }

      if (this.buffer.length < FRAME_LENGTH) {
        break;
      }

      const candidate = this.buffer.slice(0, FRAME_LENGTH);
      const parsed = parseFrame(candidate);
      if (parsed) {
        frames.push(parsed);
        this.buffer = this.buffer.slice(FRAME_LENGTH);
        continue;
      }

      this.buffer = this.buffer.slice(1);
    }

    return frames;
  }

  private findHeader(bytes: Uint8Array): number {
    for (let i = 0; i < bytes.length - 1; i++) {
      if (bytes[i] === FRAME_HEADER_1 && bytes[i + 1] === FRAME_HEADER_2) {
        return i;
      }
    }
    return -1;
  }
}

function isSerialPortNotFound(error: Error): boolean {
  const message = error.message.toLowerCase();
  return message.includes("no such file") || message.includes("cannot open") || message.includes("file not found") || message.includes("enoent");
}

async function configureSerialPort(config: AppConfig): Promise<void> {
  if (Deno.build.os === "windows") {
    throw new Error("Serial mode is currently implemented for macOS/Linux only in this Deno build.");
  }

  const sttyFlag = Deno.build.os === "darwin" ? "-f" : "-F";
  const stopBits = config.input.serial.stopBits === 2 ? "cstopb" : "-cstopb";
  const parity = config.input.serial.parity === "none"
    ? "-parenb"
    : config.input.serial.parity === "even"
    ? "parenb -parodd"
    : "parenb parodd";

  const command = new Deno.Command("stty", {
    args: [
      sttyFlag,
      config.input.serial.path,
      String(config.input.serial.baudRate),
      `cs${config.input.serial.dataBits}`,
      stopBits,
      ...parity.split(" "),
      "raw",
      "-echo",
      "-icanon",
      "min",
      "1",
      "time",
      "0",
    ],
  });

  const result = await command.output();
  if (!result.success) {
    const errorText = new TextDecoder().decode(result.stderr).trim() || "Failed to configure serial port via stty";
    throw new Error(errorText);
  }
}

async function loadConfig(configPath?: string): Promise<LoadedConfig> {
  const explicitConfig = configPath ?? Deno.env.get("TOFLYPT_CONFIG");
  const candidates = explicitConfig
    ? [resolve(explicitConfig)]
    : [
      join(dirname(Deno.execPath()), "config.json"),
      resolve("./config.json"),
    ];

  let lastError: Error | null = null;

  for (const candidate of candidates) {
    try {
      const content = await Deno.readTextFile(candidate);
      return {
        config: JSON.parse(content) as AppConfig,
        path: candidate,
      };
    } catch (error: unknown) {
      if (error instanceof Deno.errors.NotFound) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  const searched = candidates.join(", ");
  throw new Error(`Config file not found. Tried: ${searched}${lastError ? ` (${lastError.message})` : ""}`);
}

async function createFlyPtSender(config: AppConfig): Promise<(frame: MotionFrame) => Promise<void>> {
  if (!config.flypt.enabled) {
    return async () => {};
  }

  const socket = dgram.createSocket("udp4");
  let hasLoggedFlyPtConnected = false;
  console.log(green(`${getTimestamp(config.display.showTimestamp)}FlyPT UDP client ready -> ${config.flypt.host}:${config.flypt.port}`));
  return async (frame: MotionFrame) => {
    const packet = buildFlyPtPacket(frame);
    await new Promise<void>((resolveSend, rejectSend) => {
      socket.send(packet, config.flypt.port, config.flypt.host, (error: Error | null) => {
        if (error) {
          rejectSend(error);
          return;
        }
        resolveSend();
      });
    });

    if (!hasLoggedFlyPtConnected) {
      hasLoggedFlyPtConnected = true;
      console.log(green(`${getTimestamp(config.display.showTimestamp)}FlyPT connected ${config.flypt.host}:${config.flypt.port}`));
    }
  };
}

async function startUdpInput(config: AppConfig, onFrame: (frame: MotionFrame) => Promise<void>) {
  const socket = dgram.createSocket("udp4");
  const buffers = new Map<string, FrameBuffer>();

  console.log(cyan(`${getTimestamp(config.display.showTimestamp)}Creating UDP server on ${config.input.udp.host}:${config.input.udp.port}`));

  await new Promise<void>((resolveBind, rejectBind) => {
    socket.once("error", rejectBind);
    socket.bind(config.input.udp.port, config.input.udp.host, () => {
      socket.off("error", rejectBind);
      resolveBind();
    });
  });

  console.log(green(`${getTimestamp(config.display.showTimestamp)}UDP listening on ${config.input.udp.host}:${config.input.udp.port}`));

  socket.on("message", (data: Uint8Array, remote: RemoteInfo) => {
    const key = `${remote.address}:${remote.port}`;
    const buffer = buffers.get(key) ?? new FrameBuffer();
    buffers.set(key, buffer);

    const frames = buffer.push(data);
    for (const frame of frames) {
      void onFrame(frame);
    }
  });

  socket.on("error", (error: Error) => {
    console.error(red(`${getTimestamp(config.display.showTimestamp)}UDP error: ${error.message}`));
  });

  await new Promise<void>(() => {});
}

async function startSerialInput(config: AppConfig, onFrame: (frame: MotionFrame) => Promise<void>) {
  console.log(cyan(`${getTimestamp(config.display.showTimestamp)}Connecting serial port ${config.input.serial.path} @ ${config.input.serial.baudRate}`));

  await configureSerialPort(config);

  const port = await Deno.open(config.input.serial.path, { read: true });

  const buffer = new FrameBuffer();

  console.log(green(`${getTimestamp(config.display.showTimestamp)}Serial port connected ${config.input.serial.path}`));

  const readBuffer = new Uint8Array(1024);
  try {
    while (true) {
      const bytesRead = await port.read(readBuffer);
      if (bytesRead === null) {
        break;
      }

      const chunk = readBuffer.slice(0, bytesRead);
      const frames = buffer.push(chunk);
      for (const frame of frames) {
        await onFrame(frame);
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(red(`${getTimestamp(config.display.showTimestamp)}Serial error: ${error.message}`));
    }
    throw error;
  } finally {
    port.close();
  }
}

async function main() {
  const args = parseArgs(Deno.args, {
    string: ["config"],
    alias: { c: "config" },
  });

  const loadedConfig = await loadConfig(args.config);
  const config = loadedConfig.config;

  console.log(green(`${getTimestamp(config.display.showTimestamp)}Config loaded from ${loadedConfig.path}`));
  console.log(cyan(`${getTimestamp(config.display.showTimestamp)}Input mode: ${config.input.mode}`));

  if (config.flypt.enabled) {
    console.log(cyan(`${getTimestamp(config.display.showTimestamp)}FlyPT forwarding enabled -> ${config.flypt.host}:${config.flypt.port}`));
  } else {
    console.log(yellow(`${getTimestamp(config.display.showTimestamp)}FlyPT forwarding disabled`));
  }

  const forwardToFlyPt = await createFlyPtSender(config);

  const onFrame = async (frame: MotionFrame) => {
    const compensatedFrame = compensateGravity(frame);

    if (config.flypt.enabled) {
      await forwardToFlyPt(compensatedFrame);
    }
  };

  if (config.input.mode === "udp") {
    await startUdpInput(config, onFrame);
    return;
  }

  if (config.input.mode === "serial") {
    try {
      await startSerialInput(config, onFrame);
    } catch (error) {
      if (error instanceof Error && isSerialPortNotFound(error)) {
        console.error(red(`${getTimestamp(config.display.showTimestamp)}Serial port not found: ${config.input.serial.path}`));
      }
      throw error;
    }
    return;
  }

  throw new Error(`Unsupported input mode: ${config.input.mode}`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(red(`Fatal error: ${error instanceof Error ? error.stack ?? error.message : String(error)}`));
    Deno.exit(1);
  });
}
