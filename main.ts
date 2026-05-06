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
  filter: {
    enabled: boolean;
    positionAlpha: number;
    speedAlpha: number;
    positionDeadzone: number;
    speedDeadzone: number;
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
const DEFAULT_FILTER_CONFIG = {
  enabled: false,
  positionAlpha: 0.12,
  speedAlpha: 0.08,
  positionDeadzone: 0.2,
  speedDeadzone: 0.5,
} as const;

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

function applyDeadzone(value: number, threshold: number): number {
  return Math.abs(value) < threshold ? 0 : value;
}

function applyLowPass(previous: number | null, current: number, alpha: number): number {
  if (previous === null) {
    return current;
  }

  return previous + alpha * (current - previous);
}

function createFrameFilter(config: AppConfig): (frame: MotionFrame) => MotionFrame {
  if (!config.filter.enabled) {
    return (frame: MotionFrame) => frame;
  }

  let previousRollPos: number | null = null;
  let previousPitchPos: number | null = null;
  let previousYawPos: number | null = null;
  let previousRollSpeed: number | null = null;
  let previousPitchSpeed: number | null = null;
  let previousYawSpeed: number | null = null;

  return (frame: MotionFrame) => {
    const rollPos = applyDeadzone(
      applyLowPass(previousRollPos, frame.rollPos, config.filter.positionAlpha),
      config.filter.positionDeadzone,
    );
    previousRollPos = rollPos;

    const pitchPos = applyDeadzone(
      applyLowPass(previousPitchPos, frame.pitchPos, config.filter.positionAlpha),
      config.filter.positionDeadzone,
    );
    previousPitchPos = pitchPos;

    const yawPos = applyLowPass(previousYawPos, frame.yawPos, config.filter.positionAlpha);
    previousYawPos = yawPos;

    const rollSpeed = applyDeadzone(
      applyLowPass(previousRollSpeed, frame.rollSpeed, config.filter.speedAlpha),
      config.filter.speedDeadzone,
    );
    previousRollSpeed = rollSpeed;

    const pitchSpeed = applyDeadzone(
      applyLowPass(previousPitchSpeed, frame.pitchSpeed, config.filter.speedAlpha),
      config.filter.speedDeadzone,
    );
    previousPitchSpeed = pitchSpeed;

    const yawSpeed = applyDeadzone(
      applyLowPass(previousYawSpeed, frame.yawSpeed, config.filter.speedAlpha),
      config.filter.speedDeadzone,
    );
    previousYawSpeed = yawSpeed;

    return {
      ...frame,
      rollPos,
      pitchPos,
      yawPos,
      rollSpeed,
      pitchSpeed,
      yawSpeed,
    };
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

function buildFlyPtPayload(frame: MotionFrame): Uint8Array {
  const payload = new Uint8Array(PAYLOAD_LENGTH);
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
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
  return payload;
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

function getWindowsParity(parity: Parity): "n" | "e" | "o" {
  if (parity === "even") {
    return "e";
  }

  if (parity === "odd") {
    return "o";
  }

  return "n";
}

function getSerialDevicePath(path: string): string {
  if (Deno.build.os !== "windows") {
    return path;
  }

  if (path.startsWith("\\\\.\\")) {
    return path;
  }

  return `\\\\.\\${path}`;
}

async function configureSerialPort(config: AppConfig): Promise<void> {
  if (Deno.build.os === "windows") {
    const command = new Deno.Command("cmd", {
      args: [
        "/c",
        "mode",
        `${config.input.serial.path}:`,
        `BAUD=${config.input.serial.baudRate}`,
        `PARITY=${getWindowsParity(config.input.serial.parity)}`,
        `DATA=${config.input.serial.dataBits}`,
        `STOP=${config.input.serial.stopBits}`,
      ],
    });

    const result = await command.output();
    if (!result.success) {
      const stderr = new TextDecoder().decode(result.stderr).trim();
      const stdout = new TextDecoder().decode(result.stdout).trim();
      throw new Error(stderr || stdout || "Failed to configure serial port via mode");
    }

    return;
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
      const parsed = JSON.parse(content) as Partial<AppConfig>;
      return {
        config: {
          ...parsed,
          filter: {
            ...DEFAULT_FILTER_CONFIG,
            ...(parsed.filter ?? {}),
          },
        } as AppConfig,
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
  let hasLoggedFlyPtForwardingActive = false;
  console.log(green(`${getTimestamp(config.display.showTimestamp)}FlyPT UDP client ready -> ${config.flypt.host}:${config.flypt.port}`));
  return async (frame: MotionFrame) => {
    const packet = buildFlyPtPayload(frame);
    await new Promise<void>((resolveSend, rejectSend) => {
      socket.send(packet, config.flypt.port, config.flypt.host, (error: Error | null) => {
        if (error) {
          rejectSend(error);
          return;
        }
        resolveSend();
      });
    });

    if (!hasLoggedFlyPtForwardingActive) {
      hasLoggedFlyPtForwardingActive = true;
      console.log(green(`${getTimestamp(config.display.showTimestamp)}FlyPT forwarding active -> ${config.flypt.host}:${config.flypt.port}`));
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
  console.log(cyan(`${getTimestamp(config.display.showTimestamp)}Configuring serial port ${config.input.serial.path} @ ${config.input.serial.baudRate}`));

  await configureSerialPort(config);
  console.log(green(`${getTimestamp(config.display.showTimestamp)}Serial port ready ${config.input.serial.path}`));
  console.log(cyan(`${getTimestamp(config.display.showTimestamp)}Waiting for serial data on ${config.input.serial.path}`));

  const port = await Deno.open(getSerialDevicePath(config.input.serial.path), { read: true });

  const buffer = new FrameBuffer();
  let hasLoggedSerialDataDetected = false;

  const readBuffer = new Uint8Array(1024);
  try {
    while (true) {
      const bytesRead = await port.read(readBuffer);
      if (bytesRead === null) {
        break;
      }

      const chunk = readBuffer.slice(0, bytesRead);

      if (!hasLoggedSerialDataDetected) {
        hasLoggedSerialDataDetected = true;
        console.log(green(`${getTimestamp(config.display.showTimestamp)}Serial data stream detected on ${config.input.serial.path}`));
      }

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
  const filterFrame = createFrameFilter(config);
  let lastRxLogAt = 0;
  let lastTxLogAt = 0;

  const onFrame = async (frame: MotionFrame) => {
    const compensatedFrame = compensateGravity(frame);
    const filteredFrame = filterFrame(compensatedFrame);

    const now = Date.now();
    if (now - lastRxLogAt >= 1000) {
      lastRxLogAt = now;
      console.log(cyan(`${getTimestamp(config.display.showTimestamp)}RX ${formatFrame(filteredFrame, config.display.pretty)}`));
    }

    if (config.flypt.enabled) {
      await forwardToFlyPt(filteredFrame);

      if (now - lastTxLogAt >= 1000) {
        lastTxLogAt = now;
        console.log(yellow(`${getTimestamp(config.display.showTimestamp)}TX ${formatFrame(filteredFrame, config.display.pretty)} -> ${config.flypt.host}:${config.flypt.port}`));
      }
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
